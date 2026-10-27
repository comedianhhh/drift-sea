import { json, ipHash, ID_RE } from '../../lib/http.js';
import { REPORT_LIMIT } from '../../lib/moderation.js';

// POST /api/report {id}: one report per person per creature; enough reports take it out of the sea
export async function onRequestPost({ request, env }) {
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
