// Anonymous usage stats for Solver for Sparx (Cloudflare Worker + D1, free tier).
//   POST /collect  — the extension's once-a-day ping (one D1 row write)
//   GET  /stats    — JSON for the dashboard, needs ?key= (STATS_KEY secret)
//   GET  /         — the dashboard page
import dashboard from './dashboard.html';

export const EVENT_KEYS = ['open', 'solve', 'autofill_start', 'autofill_submit', 'club_start', 'club_answer', 'calc_open', 'bookwork_auto', 'ai_error',
  'stop_keyboard', 'stop_no_card', 'stop_no_box', 'stop_wrong', 'stop_picture', 'stop_error',
  'reader_open', 'reader_answer', 'reader_ai', 'reader_autofill_start', 'reader_error'];
// An active user answered at least one question that day (opening Sparx isn't enough).
const MATHS_ACTIVE = '(solve + autofill_submit + club_answer + bookwork_auto) > 0';
const READER_ACTIVE = 'reader_answer > 0';
const ACTIVE = `(${MATHS_ACTIVE} OR ${READER_ACTIVE})`;
const MODELS = ['groq', 'claude', 'gemini', 'pro'];
const MAX_DAYS_BACK = 8;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_COUNT = 500;
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' };

export function utcDay(offsetDays = 0) {
  return new Date(Date.now() - offsetDays * 86400000).toISOString().slice(0, 10);
}

function cleanCounts(raw) {
  raw = raw && typeof raw === 'object' ? raw : {};
  return EVENT_KEYS.map((k) => {
    const n = Math.floor(Number(raw[k]));
    return n > 0 ? Math.min(n, MAX_COUNT) : 0;
  });
}

// Pure: validate a ping → { id, v, model, days: [{ day, counts }] }, or null.
// 2.0.4+ sends `days` (counts per UTC day); older versions send one `counts`
// for whenever since their last ping, which is filed under today.
export function parsePing(body, today = utcDay()) {
  if (!body || typeof body !== 'object') return null;
  const id = String(body.id || '');
  const v = String(body.v || '');
  if (!UUID.test(id) || !/^\d{1,3}(\.\d{1,3}){0,3}$/.test(v)) return null;
  const model = MODELS.includes(body.model) ? body.model : 'other';
  const oldest = new Date(Date.parse(today) - MAX_DAYS_BACK * 86400000).toISOString().slice(0, 10);
  let days;
  if (Array.isArray(body.days)) {
    const byDay = {};
    body.days.slice(0, MAX_DAYS_BACK + 1).forEach((x) => {
      let day = x && typeof x.day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(x.day) ? x.day : null;
      if (!day || day < oldest) return;
      if (day > today) day = today; // clock ahead
      const c = cleanCounts(x.counts);
      byDay[day] = byDay[day] ? byDay[day].map((n, i) => Math.min(n + c[i], MAX_COUNT)) : c;
    });
    days = Object.keys(byDay).map((day) => ({ day, counts: byDay[day] }));
    if (!days.length) return null;
  } else {
    days = [{ day: today, counts: cleanCounts(body.counts) }];
  }
  return { id: id.toLowerCase(), v, model, days };
}

// Same user pinging twice in a day (e.g. two browsers) adds to one row.
const UPSERT = `INSERT INTO pings (day, id, v, model, ${EVENT_KEYS.join(', ')})
  VALUES (?, ?, ?, ?, ${EVENT_KEYS.map(() => '?').join(', ')})
  ON CONFLICT(day, id) DO UPDATE SET v = excluded.v, model = excluded.model,
  ${EVENT_KEYS.map((k) => `${k} = MIN(${k} + excluded.${k}, 100000)`).join(', ')}`;

async function keyOk(given, want) {
  if (!want || typeof given !== 'string') return false;
  const enc = new TextEncoder();
  const [a, b] = await Promise.all([crypto.subtle.digest('SHA-256', enc.encode(given)), crypto.subtle.digest('SHA-256', enc.encode(want))]);
  const x = new Uint8Array(a), y = new Uint8Array(b);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

async function stats(env) {
  const d90 = utcDay(89), d30 = utcDay(29), d7 = utcDay(6);
  const sums = EVENT_KEYS.map((k) => `SUM(${k}) AS ${k}`).join(', ');
  const [dauRows, wau, mau, ev7, ev30, vers, models] = await env.DB.batch([
    env.DB.prepare(`SELECT day, SUM(${ACTIVE}) AS users, SUM(${MATHS_ACTIVE}) AS maths, SUM(${READER_ACTIVE}) AS reader, COUNT(*) AS opened
      FROM pings WHERE day >= ? GROUP BY day`).bind(d90),
    env.DB.prepare(`SELECT COUNT(DISTINCT CASE WHEN ${ACTIVE} THEN id END) AS n, COUNT(DISTINCT CASE WHEN ${MATHS_ACTIVE} THEN id END) AS maths,
      COUNT(DISTINCT CASE WHEN ${READER_ACTIVE} THEN id END) AS reader FROM pings WHERE day >= ?`).bind(d7),
    env.DB.prepare(`SELECT COUNT(DISTINCT CASE WHEN ${ACTIVE} THEN id END) AS n, COUNT(DISTINCT CASE WHEN ${MATHS_ACTIVE} THEN id END) AS maths,
      COUNT(DISTINCT CASE WHEN ${READER_ACTIVE} THEN id END) AS reader FROM pings WHERE day >= ?`).bind(d30),
    env.DB.prepare(`SELECT ${sums} FROM pings WHERE day >= ?`).bind(d7),
    env.DB.prepare(`SELECT ${sums} FROM pings WHERE day >= ?`).bind(d30),
    env.DB.prepare('SELECT v, COUNT(*) AS n FROM pings WHERE day >= ? GROUP BY v').bind(d7),
    env.DB.prepare('SELECT model, COUNT(*) AS n FROM pings WHERE day >= ? GROUP BY model').bind(d7)
  ]);
  const byDay = {};
  dauRows.results.forEach((r) => { byDay[r.day] = r; });
  const dau = [];
  for (let i = 89; i >= 0; i--) {
    const d = utcDay(i), r = byDay[d] || {};
    dau.push({ day: d, users: r.users || 0, maths: r.maths || 0, reader: r.reader || 0, opened: r.opened || 0 });
  }
  const clean = (row) => { const o = {}; EVENT_KEYS.forEach((k) => { if (row && row[k]) o[k] = row[k]; }); return o; };
  const toObj = (rows, k) => { const o = {}; rows.results.forEach((r) => { o[r[k]] = r.n; }); return o; };
  return {
    generated: new Date().toISOString(), dau,
    wau: wau.results[0].n, mau: mau.results[0].n,
    wauSplit: { maths: wau.results[0].maths, reader: wau.results[0].reader },
    mauSplit: { maths: mau.results[0].maths, reader: mau.results[0].reader },
    events7: clean(ev7.results[0]), events30: clean(ev30.results[0]),
    versions7: toObj(vers, 'v'), models7: toObj(models, 'model')
  };
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === '/collect') {
      if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
      if (request.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: CORS });
      let body = null;
      try { body = await request.json(); } catch (e) {}
      const p = parsePing(body);
      if (!p) return Response.json({ ok: false }, { status: 400, headers: CORS });
      try {
        const stmt = env.DB.prepare(UPSERT);
        await env.DB.batch(p.days.map((x) => stmt.bind(x.day, p.id, p.v, p.model, ...x.counts)));
        return Response.json({ ok: true }, { headers: CORS });
      } catch (e) {
        return Response.json({ ok: false }, { status: 500, headers: CORS });
      }
    }
    if (url.pathname === '/stats') {
      if (!(await keyOk(url.searchParams.get('key'), env.STATS_KEY))) return Response.json({ error: 'bad key' }, { status: 401 });
      // Cache for 5 minutes — each refresh scans up to 90 days of rows, and
      // the free tier allows 5M row reads a day.
      const cache = caches.default;
      const cacheKey = new Request(url.origin + '/stats-cache');
      let res = await cache.match(cacheKey);
      if (!res) {
        try {
          res = Response.json(await stats(env), { headers: { 'Cache-Control': 'max-age=300' } });
          ctx.waitUntil(cache.put(cacheKey, res.clone()));
        } catch (e) {
          return Response.json({ error: String(e.message || e) }, { status: 500 });
        }
      }
      return new Response(res.body, { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
    }
    if (url.pathname === '/' || url.pathname === '/index.html') {
      return new Response(dashboard, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'X-Robots-Tag': 'noindex', 'Cache-Control': 'no-store' } });
    }
    return new Response('Not found', { status: 404 });
  }
};
