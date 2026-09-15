const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8' };
const SESSION_MAX_AGE = 60 * 60 * 24 * 30;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    try {
      if (!url.pathname.startsWith('/api/')) {
        return env.ASSETS.fetch(request);
      }

      if (url.pathname === '/api/health') {
        return json({ ok: true, app: env.APP_NAME || 'Sozan Tutor OS' });
      }

      if (url.pathname === '/api/login' && request.method === 'POST') {
        return handleLogin(request, env);
      }

      if (url.pathname === '/api/logout' && request.method === 'POST') {
        return new Response(null, {
          status: 204,
          headers: { 'set-cookie': 'sozan_session=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0' }
        });
      }

      const auth = await requireAuth(request, env);
      if (auth) return auth;

      if (url.pathname === '/api/dashboard' && request.method === 'GET') {
        return dashboard(url, env);
      }
      if (url.pathname === '/api/schedule' && request.method === 'GET') {
        return listSchedule(env);
      }
      if (url.pathname === '/api/schedule' && request.method === 'POST') {
        return createSchedule(request, env);
      }
      if (url.pathname.match(/^\/api\/schedule\/\d+$/) && request.method === 'PATCH') {
        return updateSchedule(request, url, env);
      }
      if (url.pathname.match(/^\/api\/schedule\/\d+$/) && request.method === 'DELETE') {
        return deleteSchedule(url, env);
      }
      if (url.pathname.match(/^\/api\/occurrences\/\d+$/) && request.method === 'PATCH') {
        return updateOccurrence(request, url, env);
      }
      if (url.pathname === '/api/transactions' && request.method === 'GET') {
        return listTransactions(url, env);
      }
      if (url.pathname === '/api/transactions' && request.method === 'POST') {
        return createTransaction(request, env);
      }
      if (url.pathname.match(/^\/api\/transactions\/\d+$/) && request.method === 'PATCH') {
        return updateTransaction(request, url, env);
      }
      if (url.pathname.match(/^\/api\/transactions\/\d+$/) && request.method === 'DELETE') {
        return deleteTransaction(url, env);
      }
      if (url.pathname === '/api/advice' && request.method === 'POST') {
        return createAdvice(env);
      }

      return json({ error: 'Not found' }, 404);
    } catch (error) {
      console.error(error);
      return json({ error: 'حدث خطأ غير متوقع', detail: String(error?.message || error) }, 500);
    }
  }
};

async function handleLogin(request, env) {
  if (!env.APP_PASSCODE || !env.SESSION_SECRET) {
    return json({ error: 'الأمان غير مُعد. أضف APP_PASSCODE و SESSION_SECRET.' }, 503);
  }
  const body = await safeJson(request);
  if (!body?.passcode || !(await safeEqual(String(body.passcode), String(env.APP_PASSCODE)))) {
    return json({ error: 'الرمز غير صحيح' }, 401);
  }
  const exp = Math.floor(Date.now() / 1000) + SESSION_MAX_AGE;
  const payload = btoa(JSON.stringify({ exp }));
  const sig = await hmac(payload, env.SESSION_SECRET);
  const token = `${toBase64Url(payload)}.${sig}`;
  const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : '';
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: {
      ...JSON_HEADERS,
      'set-cookie': `sozan_session=${token}; Path=/; HttpOnly${secure}; SameSite=Strict; Max-Age=${SESSION_MAX_AGE}`
    }
  });
}

async function requireAuth(request, env) {
  if (!env.APP_PASSCODE || !env.SESSION_SECRET) {
    return json({ error: 'التطبيق غير مؤمّن بعد. أضف أسرار الدخول قبل الاستخدام.' }, 503);
  }
  const cookie = request.headers.get('cookie') || '';
  const match = cookie.match(/(?:^|;\s*)sozan_session=([^;]+)/);
  if (!match) return json({ error: 'AUTH_REQUIRED' }, 401);
  const [payloadB64, sig] = match[1].split('.');
  if (!payloadB64 || !sig) return json({ error: 'AUTH_REQUIRED' }, 401);
  const payload = fromBase64Url(payloadB64);
  const expected = await hmac(payload, env.SESSION_SECRET);
  if (!(await safeEqual(sig, expected))) return json({ error: 'AUTH_REQUIRED' }, 401);
  try {
    const data = JSON.parse(atob(payload));
    if (!data.exp || data.exp < Math.floor(Date.now() / 1000)) return json({ error: 'AUTH_REQUIRED' }, 401);
  } catch {
    return json({ error: 'AUTH_REQUIRED' }, 401);
  }
  return null;
}

async function dashboard(url, env) {
  const date = sanitizeDate(url.searchParams.get('date')) || todayISO();
  await ensureOccurrencesForDate(env.DB, date);
  const month = date.slice(0, 7);

  const sessions = await env.DB.prepare(`
    SELECT o.id, o.date, o.status, o.paid, o.gross_amount_pence, o.center_cut_pence,
           o.net_amount_pence, r.title, r.session_type, r.start_time, r.duration_minutes,
           r.travel_minutes, r.student_count, r.location, r.age_band, r.level
    FROM session_occurrences o
    JOIN recurring_sessions r ON r.id = o.recurring_session_id
    WHERE o.date = ?1
    ORDER BY r.start_time ASC
  `).bind(date).all();

  const sums = await env.DB.prepare(`
    SELECT
      COALESCE(SUM(CASE WHEN kind='income' THEN amount_pence ELSE 0 END),0) income,
      COALESCE(SUM(CASE WHEN kind='expense' AND scope='business' THEN amount_pence ELSE 0 END),0) business_expenses,
      COALESCE(SUM(CASE WHEN kind='expense' AND scope='personal' THEN amount_pence ELSE 0 END),0) personal_expenses
    FROM transactions
    WHERE substr(date,1,7) = ?1
  `).bind(month).first();

  const time = await env.DB.prepare(`
    SELECT
      COALESCE(SUM(r.duration_minutes),0) teaching_minutes,
      COALESCE(SUM(r.travel_minutes),0) travel_minutes
    FROM session_occurrences o
    JOIN recurring_sessions r ON r.id = o.recurring_session_id
    WHERE substr(o.date,1,7) = ?1 AND o.status='completed'
  `).bind(month).first();

  const pending = await env.DB.prepare(`
    SELECT COALESCE(SUM(o.net_amount_pence),0) pending
    FROM session_occurrences o
    WHERE substr(o.date,1,7)=?1 AND o.status='completed' AND o.paid=0
  `).bind(month).first();

  const income = Number(sums?.income || 0);
  const businessExpenses = Number(sums?.business_expenses || 0);
  const personalExpenses = Number(sums?.personal_expenses || 0);
  const realMinutes = Number(time?.teaching_minutes || 0) + Number(time?.travel_minutes || 0);
  const operatingProfit = income - businessExpenses;

  return json({
    date,
    month,
    sessions: sessions.results || [],
    summary: {
      income,
      business_expenses: businessExpenses,
      operating_profit: operatingProfit,
      personal_expenses: personalExpenses,
      cash_left: operatingProfit - personalExpenses,
      pending: Number(pending?.pending || 0),
      teaching_minutes: Number(time?.teaching_minutes || 0),
      travel_minutes: Number(time?.travel_minutes || 0),
      true_hourly_pence: realMinutes > 0 ? Math.round((operatingProfit * 60) / realMinutes) : 0
    }
  });
}

async function ensureOccurrencesForDate(db, date) {
  const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();
  const rows = await db.prepare(`SELECT * FROM recurring_sessions WHERE active=1 AND weekday=?1`).bind(weekday).all();
  for (const r of rows.results || []) {
    const gross = Number(r.gross_amount_pence || 0);
    const cut = Math.round(gross * Number(r.center_cut_percent || 0) / 100);
    const net = Math.max(0, gross - cut);
    await db.prepare(`
      INSERT OR IGNORE INTO session_occurrences
      (recurring_session_id,date,status,paid,gross_amount_pence,center_cut_pence,net_amount_pence)
      VALUES (?1,?2,'scheduled',0,?3,?4,?5)
    `).bind(r.id, date, gross, cut, net).run();
  }
}

async function listSchedule(env) {
  const rows = await env.DB.prepare(`SELECT * FROM recurring_sessions WHERE active=1 ORDER BY weekday,start_time`).all();
  return json({ sessions: rows.results || [] });
}

async function createSchedule(request, env) {
  const b = await safeJson(request);
  const required = ['title','session_type','weekday','start_time','duration_minutes','gross_amount'];
  for (const key of required) if (b?.[key] === undefined || b?.[key] === '') return json({ error: `Missing ${key}` }, 400);
  const allowedTypes = new Set(['private_home','private_out','online','center_group','own_group']);
  if (!allowedTypes.has(b.session_type)) return json({ error: 'نوع الحصة غير صالح' }, 400);
  const gross = moneyToPence(b.gross_amount);
  const result = await env.DB.prepare(`
    INSERT INTO recurring_sessions
    (title,session_type,weekday,start_time,duration_minutes,gross_amount_pence,center_cut_percent,travel_minutes,student_count,age_band,level,location)
    VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12)
  `).bind(
    String(b.title).trim(), b.session_type, clampInt(b.weekday,0,6), normalizeTime(b.start_time),
    clampInt(b.duration_minutes,15,360), gross, clampNumber(b.center_cut_percent || 0,0,100),
    clampInt(b.travel_minutes || 0,0,360), clampInt(b.student_count || 1,1,100),
    nullableText(b.age_band), nullableText(b.level), nullableText(b.location)
  ).run();
  return json({ ok: true, id: result.meta?.last_row_id }, 201);
}

async function updateSchedule(request, url, env) {
  const id = Number(url.pathname.split('/').pop());
  const existing = await env.DB.prepare(`SELECT id FROM recurring_sessions WHERE id=?1 AND active=1`).bind(id).first();
  if (!existing) return json({ error: 'الحصة غير موجودة' }, 404);
  const b = await safeJson(request);
  const required = ['title','session_type','weekday','start_time','duration_minutes','gross_amount'];
  for (const key of required) if (b?.[key] === undefined || b?.[key] === '') return json({ error: `Missing ${key}` }, 400);
  const allowedTypes = new Set(['private_home','private_out','online','center_group','own_group']);
  if (!allowedTypes.has(b.session_type)) return json({ error: 'نوع الحصة غير صالح' }, 400);
  const gross = moneyToPence(b.gross_amount);
  const cutPercent = clampNumber(b.center_cut_percent || 0,0,100);
  const cut = Math.round(gross * cutPercent / 100);
  const net = Math.max(0, gross - cut);
  await env.DB.prepare(`
    UPDATE recurring_sessions SET
      title=?1, session_type=?2, weekday=?3, start_time=?4, duration_minutes=?5,
      gross_amount_pence=?6, center_cut_percent=?7, travel_minutes=?8, student_count=?9,
      age_band=?10, level=?11, location=?12
    WHERE id=?13
  `).bind(
    String(b.title).trim(), b.session_type, clampInt(b.weekday,0,6), normalizeTime(b.start_time),
    clampInt(b.duration_minutes,15,360), gross, cutPercent, clampInt(b.travel_minutes || 0,0,360),
    clampInt(b.student_count || 1,1,100), nullableText(b.age_band), nullableText(b.level), nullableText(b.location), id
  ).run();
  await env.DB.prepare(`
    UPDATE session_occurrences
    SET gross_amount_pence=?1, center_cut_pence=?2, net_amount_pence=?3, updated_at=CURRENT_TIMESTAMP
    WHERE recurring_session_id=?4 AND date>=?5 AND status='scheduled' AND paid=0
  `).bind(gross, cut, net, id, todayISO()).run();
  return json({ ok: true });
}

async function deleteSchedule(url, env) {
  const id = Number(url.pathname.split('/').pop());
  await env.DB.prepare(`UPDATE recurring_sessions SET active=0 WHERE id=?1`).bind(id).run();
  return json({ ok: true });
}

async function updateOccurrence(request, url, env) {
  const id = Number(url.pathname.split('/').pop());
  const b = await safeJson(request);
  const row = await env.DB.prepare(`SELECT * FROM session_occurrences WHERE id=?1`).bind(id).first();
  if (!row) return json({ error: 'الحصة غير موجودة' }, 404);

  let status = row.status;
  let paid = Number(row.paid || 0);
  if (b.status && ['scheduled','completed','cancelled'].includes(b.status)) status = b.status;
  if (typeof b.paid === 'boolean') paid = b.paid ? 1 : 0;

  await env.DB.prepare(`UPDATE session_occurrences SET status=?1, paid=?2, updated_at=CURRENT_TIMESTAMP WHERE id=?3`)
    .bind(status, paid, id).run();

  const existing = await env.DB.prepare(`SELECT id FROM transactions WHERE occurrence_id=?1 AND kind='income' LIMIT 1`).bind(id).first();
  if (paid && !existing && status !== 'cancelled') {
    await env.DB.prepare(`
      INSERT INTO transactions(date,kind,scope,category,amount_pence,source,note,occurrence_id)
      VALUES (?1,'income','business','lesson',?2,'session','تحصيل حصة',?3)
    `).bind(row.date, row.net_amount_pence, id).run();
  }
  if (!paid && existing) {
    await env.DB.prepare(`DELETE FROM transactions WHERE id=?1`).bind(existing.id).run();
  }
  return json({ ok: true });
}

async function listTransactions(url, env) {
  const month = /^\d{4}-\d{2}$/.test(url.searchParams.get('month') || '') ? url.searchParams.get('month') : todayISO().slice(0,7);
  const rows = await env.DB.prepare(`SELECT * FROM transactions WHERE substr(date,1,7)=?1 ORDER BY date DESC,id DESC LIMIT 200`).bind(month).all();
  return json({ month, transactions: rows.results || [] });
}

async function createTransaction(request, env) {
  const b = await safeJson(request);
  const kind = b?.kind === 'income' ? 'income' : 'expense';
  const scope = ['business','personal','na'].includes(b?.scope) ? b.scope : (kind === 'expense' ? 'business' : 'business');
  const amount = moneyToPence(b?.amount);
  if (amount <= 0) return json({ error: 'المبلغ يجب أن يكون أكبر من صفر' }, 400);
  const date = sanitizeDate(b?.date) || todayISO();
  await env.DB.prepare(`
    INSERT INTO transactions(date,kind,scope,category,amount_pence,source,note)
    VALUES (?1,?2,?3,?4,?5,'manual',?6)
  `).bind(date, kind, scope, String(b?.category || 'other'), amount, nullableText(b?.note)).run();
  return json({ ok: true }, 201);
}

async function updateTransaction(request, url, env) {
  const id = Number(url.pathname.split('/').pop());
  const existing = await env.DB.prepare(`SELECT * FROM transactions WHERE id=?1`).bind(id).first();
  if (!existing) return json({ error: 'الحركة غير موجودة' }, 404);
  if (existing.source !== 'manual') return json({ error: 'هذه الحركة مرتبطة بحصة. عدّلي حالة الدفع من صفحة اليوم.' }, 409);
  const b = await safeJson(request);
  const kind = b?.kind === 'income' ? 'income' : 'expense';
  const scope = ['business','personal','na'].includes(b?.scope) ? b.scope : 'business';
  const amount = moneyToPence(b?.amount);
  if (amount <= 0) return json({ error: 'المبلغ يجب أن يكون أكبر من صفر' }, 400);
  const date = sanitizeDate(b?.date) || existing.date || todayISO();
  await env.DB.prepare(`
    UPDATE transactions SET date=?1,kind=?2,scope=?3,category=?4,amount_pence=?5,note=?6
    WHERE id=?7
  `).bind(date,kind,scope,String(b?.category || 'other'),amount,nullableText(b?.note),id).run();
  return json({ ok: true });
}

async function deleteTransaction(url, env) {
  const id = Number(url.pathname.split('/').pop());
  const existing = await env.DB.prepare(`SELECT * FROM transactions WHERE id=?1`).bind(id).first();
  if (!existing) return json({ error: 'الحركة غير موجودة' }, 404);
  if (existing.source !== 'manual') return json({ error: 'هذه الحركة مرتبطة بحصة. ألغِي الدفع من صفحة اليوم.' }, 409);
  await env.DB.prepare(`DELETE FROM transactions WHERE id=?1`).bind(id).run();
  return json({ ok: true });
}

async function createAdvice(env) {
  const end = todayISO();
  const start = new Date(Date.now() - 28 * 86400000).toISOString().slice(0,10);
  const rows = await env.DB.prepare(`
    SELECT r.session_type, r.id recurring_id, r.duration_minutes, r.travel_minutes, r.student_count,
           r.age_band, r.level,
           COUNT(o.id) completed_count,
           COALESCE(SUM(o.net_amount_pence),0) earned_pence
    FROM recurring_sessions r
    LEFT JOIN session_occurrences o ON o.recurring_session_id=r.id AND o.status='completed' AND o.date BETWEEN ?1 AND ?2
    WHERE r.active=1
    GROUP BY r.id
  `).bind(start,end).all();

  const tx = await env.DB.prepare(`
    SELECT
      COALESCE(SUM(CASE WHEN kind='income' THEN amount_pence ELSE 0 END),0) income,
      COALESCE(SUM(CASE WHEN kind='expense' AND scope='business' THEN amount_pence ELSE 0 END),0) business_expenses,
      COALESCE(SUM(CASE WHEN kind='expense' AND scope='personal' THEN amount_pence ELSE 0 END),0) personal_expenses
    FROM transactions WHERE date BETWEEN ?1 AND ?2
  `).bind(start,end).first();

  const anon = (rows.results || []).map((r, i) => ({
    ref: `S${i+1}`,
    type: r.session_type,
    duration_minutes: r.duration_minutes,
    travel_minutes: r.travel_minutes,
    student_count: r.student_count,
    age_band: r.age_band,
    level: r.level,
    completed_count: r.completed_count,
    earned: penceToMoney(r.earned_pence),
    effective_per_hour: effectiveRate(r)
  }));

  const deterministic = buildDeterministicAdvice(anon, tx);
  return json({ source: 'rules', advice: deterministic });
}

function buildDeterministicAdvice(sessions, tx) {
  const lines = [];
  const active = sessions.filter(s => s.completed_count > 0);
  if (active.length) {
    const sorted = [...active].sort((a,b) => a.effective_per_hour - b.effective_per_hour);
    const low = sorted[0];
    const high = sorted[sorted.length-1];
    if (low && high && high.effective_per_hour > low.effective_per_hour * 1.25) {
      lines.push(`1) راجعي ${low.ref}: عائده الفعلي حوالي ${low.effective_per_hour.toFixed(0)} في الساعة مقابل ${high.effective_per_hour.toFixed(0)} لـ${high.ref}. اختبري رفع السعر أو تقليل الانتقال/دمج الموعد لمدة أسبوعين.`);
    }
  }
  const personal = penceToMoney(tx.personal_expenses || 0);
  const income = penceToMoney(tx.income || 0);
  if (income > 0 && personal / income > 0.3) {
    lines.push(`2) المصروف الشخصي يمثل تقريبًا ${Math.round((personal/income)*100)}% من الدخل المسجل. افصلي مبلغًا شخصيًا أسبوعيًا ثابتًا واختبري الالتزام به أسبوعين.`);
  }
  const privates = sessions.filter(s => ['private_home','private_out','online'].includes(s.type) && s.student_count === 1);
  const groups = new Map();
  for (const p of privates) {
    const key = `${p.age_band || ''}|${p.level || ''}`;
    if (key !== '|' && !groups.has(key)) groups.set(key, []);
    if (key !== '|') groups.get(key).push(p);
  }
  const candidate = [...groups.values()].find(g => g.length >= 3);
  if (candidate) lines.push(`3) يوجد ${candidate.length} حصص فردية لها نفس نطاق السن/المستوى. لا تدمجيهم فورًا؛ اختبري عرض مجموعة صغيرة اختيارية على 3 أسر أولًا وقارني الدخل لكل ساعة.`);
  if (!lines.length) lines.push('1) البيانات الحالية غير كافية لحكم قوي. سجلي الحصص والمدفوعات والمصروفات لمدة 14 يومًا ثم أعيدي التحليل.', '2) لا تضيفي عملاء جدد قبل معرفة العائد الحقيقي لكل ساعة.', '3) افصلي مصروف العمل عن المصروف الشخصي في كل تسجيل.');
  return lines.slice(0,3).join('\n');
}

function effectiveRate(r) {
  const sessions = Number(r.completed_count || 0);
  if (!sessions) return 0;
  const mins = sessions * (Number(r.duration_minutes || 0) + Number(r.travel_minutes || 0));
  return mins ? (penceToMoney(r.earned_pence) * 60 / mins) : 0;
}

function json(data, status = 200) { return new Response(JSON.stringify(data), { status, headers: JSON_HEADERS }); }
async function safeJson(request) { try { return await request.json(); } catch { return null; } }
function todayISO() { return new Date().toISOString().slice(0,10); }
function sanitizeDate(v) { return /^\d{4}-\d{2}-\d{2}$/.test(v || '') ? v : null; }
function normalizeTime(v) { return /^\d{2}:\d{2}$/.test(v || '') ? v : '09:00'; }
function nullableText(v) { const s = String(v ?? '').trim(); return s ? s.slice(0,300) : null; }
function clampInt(v,min,max) { return Math.min(max, Math.max(min, Math.round(Number(v) || 0))); }
function clampNumber(v,min,max) { return Math.min(max, Math.max(min, Number(v) || 0)); }
function moneyToPence(v) { const n = Number(String(v ?? '').replace(',','.')); return Number.isFinite(n) ? Math.max(0, Math.round(n * 100)) : 0; }
function penceToMoney(v) { return Number(v || 0) / 100; }

async function hmac(message, secret) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), {name:'HMAC',hash:'SHA-256'}, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
  return toBase64Url(String.fromCharCode(...new Uint8Array(sig)));
}
function toBase64Url(s) { return btoa(s).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,''); }
function fromBase64Url(s) { const pad = s.length % 4 ? '='.repeat(4 - (s.length % 4)) : ''; return atob((s+pad).replace(/-/g,'+').replace(/_/g,'/')); }
async function safeEqual(a,b) {
  const aa = new TextEncoder().encode(String(a));
  const bb = new TextEncoder().encode(String(b));
  if (aa.length !== bb.length) return false;
  let diff = 0; for (let i=0;i<aa.length;i++) diff |= aa[i] ^ bb[i]; return diff === 0;
}
