import app from './worker.js';

const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8' };
const PENDING_TTL_SECONDS = 30;
const REPLAY_WINDOW_SECONDS = 2;
const POLL_ATTEMPTS = 40;
const POLL_MS = 250;

const CREATE_ROUTES = new Set([
  '/api/v3/students',
  '/api/v3/sessions',
  '/api/v4/receipts',
  '/api/v3/expenses',
  '/api/v3/other-income',
  '/api/v3/cash-check'
]);

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

    if (url.pathname === '/api/v4/reset-data' && request.method === 'POST') {
      const response = await app.fetch(request, env, ctx);
      if (response.ok) await env.DB.prepare(`DELETE FROM mutation_dedupe_v1`).run();
      return response;
    }

    if (!isProtectedCreate(request, url)) {
      return app.fetch(request, env, ctx);
    }

    return dedupeCreate(request, env, ctx, url);
  }
};

function isProtectedCreate(request, url) {
  return request.method === 'POST' && CREATE_ROUTES.has(url.pathname);
}

async function dedupeCreate(request, env, ctx, url) {
  const body = await request.clone().text();
  const cookie = request.headers.get('cookie') || '';
  const fingerprint = await sha256(`${request.method}\n${url.pathname}${url.search}\n${cookie}\n${body}`);

  const existing = await readDedupe(env.DB, fingerprint);
  if (existing) {
    if (existing.status === 'done' && Number(existing.replay_fresh) === 1) {
      return replayResponse(existing);
    }
    if (existing.status === 'pending' && Number(existing.pending_fresh) === 1) {
      const replay = await waitForCompleted(env.DB, fingerprint);
      if (replay?.status === 'done') return replayResponse(replay);
      if (replay?.status === 'pending') {
        return new Response(JSON.stringify({
          error: 'العملية لسه بتتحفظ. استني لحظة من غير ما تضغطي تاني.'
        }), { status: 409, headers: JSON_HEADERS });
      }
    }
    await env.DB.prepare(`DELETE FROM mutation_dedupe_v1 WHERE dedupe_key=?1`).bind(fingerprint).run();
  }

  const claim = await env.DB.prepare(`
    INSERT OR IGNORE INTO mutation_dedupe_v1(dedupe_key,method,path,status)
    VALUES(?1,?2,?3,'pending')
  `).bind(fingerprint, request.method, `${url.pathname}${url.search}`).run();

  if (Number(claim.meta?.changes || 0) === 0) {
    const replay = await waitForCompleted(env.DB, fingerprint);
    if (replay?.status === 'done') return replayResponse(replay);
    if (!replay) return dedupeCreate(request, env, ctx, url);
    return new Response(JSON.stringify({
      error: 'العملية لسه بتتحفظ. استني لحظة من غير ما تضغطي تاني.'
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

    if (ctx?.waitUntil) {
      ctx.waitUntil(env.DB.prepare(`DELETE FROM mutation_dedupe_v1 WHERE created_at < datetime('now','-1 day')`).run());
    }
    return response;
  } catch (error) {
    await env.DB.prepare(`DELETE FROM mutation_dedupe_v1 WHERE dedupe_key=?1`).bind(fingerprint).run();
    throw error;
  }
}

async function readDedupe(db, key) {
  return db.prepare(`
    SELECT status,response_status,response_body,content_type,
      CASE WHEN created_at >= datetime('now','-${PENDING_TTL_SECONDS} seconds') THEN 1 ELSE 0 END pending_fresh,
      CASE WHEN completed_at IS NOT NULL AND completed_at >= datetime('now','-${REPLAY_WINDOW_SECONDS} seconds') THEN 1 ELSE 0 END replay_fresh
    FROM mutation_dedupe_v1 WHERE dedupe_key=?1
  `).bind(key).first();
}

async function waitForCompleted(db, key) {
  for (let i = 0; i < POLL_ATTEMPTS; i++) {
    const row = await readDedupe(db, key);
    if (!row || row.status === 'done') return row || null;
    await sleep(POLL_MS);
  }
  return readDedupe(db, key);
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
