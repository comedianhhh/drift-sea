import { json, sha16, ipHash, ID_RE, TOKEN_RE } from '../lib/http.js';
import { refused, REPORT_LIMIT } from '../lib/moderation.js';

const MAX_LEN = 60, LIST_LIMIT = 400;
const COOLDOWN_MS = 15000, DAILY_LIMIT = 30, DAY_MS = 864e5;

// GET /api/fish: the newest creatures still in the sea
async function listFish(env) {
  const { results } = await env.DB
    .prepare('SELECT id, text, at, owner FROM fish WHERE hidden = 0 ORDER BY at DESC LIMIT ?')
    .bind(LIST_LIMIT).all();
  return json({ fish: results });
}

// POST /api/fish {id, text}, header X-Visitor: release a sentence
async function releaseFish(request, env) {
  let body;
  try { body = await request.json(); } catch { return json({ error: 'bad_request' }, 400); }
  const token = request.headers.get('x-visitor') || '';
  const id = String(body.id || '');
  if (!TOKEN_RE.test(token) || !ID_RE.test(id)) return json({ error: 'bad_request' }, 400);

  const text = String(body.text || '').replace(/\s+/g, ' ').trim();
  const len = [...text].length;
  if (!len || len > MAX_LEN) return json({ error: 'length' }, 400);
  if (refused(text, env)) return json({ error: 'blocked' }, 422);

  const ip = await ipHash(request, env), now = Date.now();
  const recent = await env.DB
    .prepare('SELECT COUNT(*) AS n, MAX(at) AS last FROM fish WHERE ip = ? AND at > ?')
    .bind(ip, now - DAY_MS).first();
  if (recent && recent.last && now - recent.last < COOLDOWN_MS) return json({ error: 'slow_down' }, 429);
  if (recent && recent.n >= DAILY_LIMIT) return json({ error: 'daily_limit' }, 429);

  const owner = await sha16(token);
  try {
    await env.DB.prepare('INSERT INTO fish (id, text, at, owner, ip) VALUES (?, ?, ?, ?, ?)')
      .bind(id, text, now, owner, ip).run();
  } catch {
    return json({ error: 'duplicate' }, 409);
  }
  return json({ fish: { id, text, at: now, owner } }, 201);
}

// POST /api/report {id}: one report per person per creature; enough reports take it out of the sea
async function reportFish(request, env) {
  let body;
  try { body = await request.json(); } catch { return json({ error: 'bad_request' }, 400); }
  const id = String(body.id || '');
  if (!ID_RE.test(id)) return json({ error: 'bad_request' }, 400);

  const ip = await ipHash(request, env);
  const res = await env.DB.prepare('INSERT OR IGNORE INTO reports (fish_id, ip, at) VALUES (?, ?, ?)')
    .bind(id, ip, Date.now()).run();
  if (res.meta.changes) {
    await env.DB.prepare('UPDATE fish SET reports = reports + 1, hidden = CASE WHEN reports + 1 >= ? THEN 1 ELSE hidden END WHERE id = ?')
      .bind(REPORT_LIMIT, id).run();
  }
  return json({ ok: true });
}

// Static files in public/ are served before this runs; only requests with no matching file reach it.
export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);
    const m = request.method;
    if (pathname === '/api/fish') {
      if (m === 'GET') return listFish(env);
      if (m === 'POST') return releaseFish(request, env);
    } else if (pathname === '/api/report' && m === 'POST') {
      return reportFish(request, env);
    }
    if (pathname.startsWith('/api/')) return json({ error: 'not_found' }, 404);
    return env.ASSETS.fetch(request);
  },
};
