import { json, sha16, ipHash, ID_RE, TOKEN_RE } from '../../lib/http.js';
import { refused } from '../../lib/moderation.js';

const MAX_LEN = 60, LIST_LIMIT = 400;
const COOLDOWN_MS = 15000, DAILY_LIMIT = 30, DAY_MS = 864e5;

// GET /api/fish: the newest creatures still in the sea
export async function onRequestGet({ env }) {
  const { results } = await env.DB
    .prepare('SELECT id, text, at, owner FROM fish WHERE hidden = 0 ORDER BY at DESC LIMIT ?')
    .bind(LIST_LIMIT).all();
  return json({ fish: results });
}

// POST /api/fish {id, text}, header X-Visitor: release a sentence
export async function onRequestPost({ request, env }) {
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
