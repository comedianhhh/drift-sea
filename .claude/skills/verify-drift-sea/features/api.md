# API feature map

Source: `src/worker.js`, `lib/http.js`, `lib/moderation.js`, `schema.sql`. Checked automatically by `scripts/verify.mjs`. Keep this file and the script in step.

**Starting state:** a fresh local D1 with schema.sql applied and an empty sea. Visitor token `verify-token-<digits>`. One TEST-NET IP (`203.0.113.x`) per simulated person.

## Release: `POST /api/fish {id, text}`, header `X-Visitor`

| Action | Expected |
|---|---|
| valid sentence with extra spaces | 201; text collapsed/trimmed; appears in `GET /api/fish`; list has no `ip` field |
| same IP again within 15 s | 429 `slow_down` |
| same id, other IP | 409 `duplicate` |
| 60 emoji | 201 (length is counted in code points) |
| 61 chars / blank | 400 `length` |
| token not `[A-Za-z0-9-]{16,64}` / id not `[a-z0-9]{6,24}` / malformed JSON | 400 `bad_request` |

Not checked: `daily_limit` (30 per IP per day). Checking it would need 30 inserts spaced 15 s apart, or a clock seam. Add one if that code changes.

## Moderation: refused before storing → 422 `blocked`

`https://`, `www.`, bare domains (.com/.org/… list), emails, 7+ digit runs. A sentence with a short number ("version 2.0") must still pass. Not checked: the `BLOCKED_WORDS` env list. If moderation words change, add a `--var BLOCKED_WORDS:...` case.

## Report: `POST /api/report {id}`

| Action | Expected |
|---|---|
| reporter A twice + reporter B | still listed (same person counts once) |
| reporter C | hidden from the list (`REPORT_LIMIT` = 3) |
| bad id | 400 |

## Routing

An unknown `/api/*` returns 404 JSON. Everything else falls through to static assets.

## Failure conditions

- Server never answers within 90 s → BLOCKED; read `wrangler.log`. Usual causes: wrangler v3 on Node 24, a missing `node_modules` (`npm install`), or a schema error.
- The sea isn't empty at Doctor → the run hit the wrong instance or reused state → BLOCKED.
