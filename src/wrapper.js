import app from './worker.js';

const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8' };
const DEDUPE_WINDOW_SECONDS = 8;
const POLL_ATTEMPTS = 32;
const POLL_MS = 250;

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === '/api/health') {
      return new Response(JSON.stringify({
        ok: true,
        app: env.APP_NAME || 'Sozan Tutor OS',
        version: '4.4',
        mutation_dedupe: true
      }), { status: 200, headers: JSON_HEADERS });
    }

    if (!isProtectedMutation(request, url)) {
      return app.fetch(request, env, ctx);
    }

    return dedupeMutation(request, env, ctx, url);
  }
};

function isProtectedMutation(request, url) {
  if (!url.pathname.startsWith('/api/')) return false;
  if (!['POST', 'PATCH', 'DELETE'].includes(request.method)) return false;
  if (url.pathname === '/api/login' || url.pathname === '/api/logout') return false;
  return true;
}

async function dedupeMutation(request, env, ctx, url) {
  const body = await request.clone().text();
  const cookie = request.headers.get('cookie') || '';
  const fingerprint = await sha256(`${request.method}\n${url.pathname}${url.search}\n${cookie}\n${body}`);

  // Keep the table small and allow an identical legitimate action after the short protection window.
  await env.DB.prepare(`DELETE FROM mutation_dedupe_v1 WHERE created_at < datetime('now','-1 day')`).run();
  await env.DB.prepare(`DELETE FROM mutation_dedupe_v1 WHERE dedupe_key=?1 AND created_at < datetime('now','-${DEDUPE_WINDOW_SECONDS} seconds')`).bind(fingerprint).run();

  const claim = await env.DB.prepare(`
    INSERT OR IGNORE INTO mutation_dedupe_v1(dedupe_key,method,path,status)
    VALUES(?1,?2,?3,'pending')
  `).bind(fingerprint, request.method, `${url.pathname}${url.search}`).run();

  if (Number(claim.meta?.changes || 0) === 0) {
    const replay = await waitForCompleted(env.DB, fingerprint);
    if (replay?.status === 'done') return replayResponse(replay);
    if (!replay) {
      // The first attempt failed and released its claim. Let this request become the retry.
      return dedupeMutation(request, env, ctx, url);
    }
    return new Response(JSON.stringify({
      error: 'نفس العملية ما زالت بتتحفظ. استني لحظة من غير ما تضغطي تاني.'
    }), { status: 409, headers: JSON_HEADERS });
  }

  try {
    const response = await app.fetch(request, env, ctx);

    // Validation/auth/server failures must remain retryable.
    if (!response.ok) {
      await env.DB.prepare(`DELETE FROM mutation_dedupe_v1 WHERE dedupe_key=?1`).bind(fingerprint).run();
      return response;
    }

    const responseBody = await response.clone().text();
    const contentType = response.headers.get('content-type') || 'application/json; charset=utf-8';
    await env.DB.prepare(`
      UPDATE mutation_dedupe_v1
      SET status='done', response_status=?1, response_body=?2, content_type=?3, completed_at=CURRENT_TIMESTAMP
      WHERE dedupe_key=?4
    `).bind(response.status, responseBody, contentType, fingerprint).run();

    return response;
  } catch (error) {
    await env.DB.prepare(`DELETE FROM mutation_dedupe_v1 WHERE dedupe_key=?1`).bind(fingerprint).run();
    throw error;
  }
}

async function waitForCompleted(db, key) {
  for (let i = 0; i < POLL_ATTEMPTS; i++) {
    const row = await db.prepare(`SELECT status,response_status,response_body,content_type FROM mutation_dedupe_v1 WHERE dedupe_key=?1`).bind(key).first();
    if (!row || row.status === 'done') return row || null;
    await sleep(POLL_MS);
  }
  return db.prepare(`SELECT status,response_status,response_body,content_type FROM mutation_dedupe_v1 WHERE dedupe_key=?1`).bind(key).first();
}

function replayResponse(row) {
  return new Response(row.response_body || '', {
    status: Number(row.response_status || 200),
    headers: {
      'content-type': row.content_type || 'application/json; charset=utf-8',
      'x-sozan-deduplicated': '1'
    }
  });
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function sha256(value) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
}
