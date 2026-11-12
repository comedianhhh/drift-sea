---
name: verify-drift-sea
description: Verify a Drift Sea change before it is pushed (pushing to main deploys the live site). Launches a private local Worker with a fresh D1, checks it's ours, drives the API and the page, saves evidence, cleans up. Use after any change to src/, lib/, public/ or schema.sql, before commit/push, or when asked to "verify", "test" or "check" Drift Sea.
---

# Verify Drift Sea

Pushing to `main` deploys https://drift-sea.alan996.workers.dev for everyone. Nothing goes to `main` without a run of this skill whose verdict is PASS on the exact commit being pushed.

Verdicts: **PASS** (every check passed), **FAIL** (a check failed: a real regression or an outdated check), **BLOCKED** (the checks could not run, e.g. the server never started). Missing evidence counts as BLOCKED, and a new commit voids an earlier PASS.

## 1. Launch + Doctor + Drive + Cleanup (API): one command

```bash
npm run verify
```

`scripts/verify.mjs` does the following:

- **Launch**: creates a brand-new local D1 under `.verify/<run>/state` (schema.sql), starts `wrangler dev` on the first free port from 8790 on 127.0.0.1 with its own `IP_SALT`, and waits up to 90 s for `GET /api/fish`.
- **Doctor**: `GET /` must be the Drift Sea page, and the sea must start **empty**. An empty sea proves the server is this run's own private instance, not the live site, `npm run dev`'s shared `.wrangler/state`, or another run.
- **Drive**: the API checks in `features/` (release, moderation, report, routing). Each simulated visitor gets its own TEST-NET IP through `cf-connecting-ip`, which local wrangler honours.
- **Evidence**: written to `.verify/<run>/` (gitignored): `summary.md` (verdict, commit SHA, uncommitted changes, table of checks), `results.json` (every request/response), `wrangler.log`.
- **Cleanup**: kills every process whose command line contains `.verify\<run>` (wrangler *and* its workerd children), deletes the state, and then re-checks that nothing is left. Exit code 3 means cleanup was incomplete; say so.

Exit codes: 0 PASS, 1 FAIL, 2 BLOCKED, 3 cleanup incomplete.

It never contacts Cloudflare and never touches the live or remote database.

## 2. Drive the page (UI): when public/index.html changed

```bash
node scripts/verify.mjs --keep
```

This runs the same checks and leaves the server up, printing the URL and the stop command. Then, in the user's Chrome (Claude in Chrome, not the in-app browser):

1. Open the printed URL. The HUD should read **2 fish** (the two the API checks left in the sea), not the live count.
2. Type a sentence in **"Write a sentence"** and click **↗ release**. Expect the toast "Released. Everyone who visits this sea can see it now." and HUD **3 fish / 1 yours**.
3. Read console errors: there should be none.
4. Exercise whatever the change touched (field guide, clicking a creature, report). See `features/ui.md`.
5. Save a screenshot into `.verify/<run>/`, and append a "Browser check" table to that run's `summary.md`.
6. Close the tab, then **always** stop the server:

```bash
node scripts/verify.mjs stop <run>
```

It must print `0 left, state removed`.

## 3. Report

Give the verdict, the commit SHA from `summary.md`, the check counts, the path to the evidence, and anything that was not checked (for example, "UI not checked: no front-end change"). If the working tree had uncommitted changes, the PASS covers that tree, not a commit. Re-run after committing.

## When a check fails

- Read `results.json` for that check's request and response, then decide whether the code or the check is wrong. Never weaken a check just to get a PASS. If behaviour changed on purpose, update the check and its feature file in the same commit, and say so.
- A bug the user had to catch by hand should become a new check in `scripts/verify.mjs` plus a line in the feature file. That way the next run catches it automatically.

## Known traps (found by trial runs)

- `npx wrangler` behind a shell leaves orphaned workerd processes that `taskkill /T` can't reach. That's why the script runs `node_modules/wrangler/bin/wrangler.js` directly and cleans up by run marker.
- A PowerShell query that has the marker in its own command line matches itself. That's why the marker is passed through the `VERIFY_MARK` env var.
- On Windows, the `--keep` server must be spawned `detached`, or it dies when the script exits.
- The sea's cooldown is per IP (15 s). Any new check that releases twice must use a new IP, or it will hit `slow_down`.
- Wrangler must be v4, because v3 crashes on Node 24.
