#!/usr/bin/env node
// Drift Sea verification run: launch a private local Worker, check it's ours, drive the API, save evidence, clean up.
// Usage:
//   node scripts/verify.mjs            full run, stops the server at the end
//   node scripts/verify.mjs --keep     same, but leaves the server up for a browser check (prints how to stop it)
//   node scripts/verify.mjs stop <run> stop a server left up by --keep
// Evidence lands in .verify/<run>/ (gitignored): summary.md, results.json, wrangler.log.
// Nothing here talks to Cloudflare: the database is a fresh local D1 under .verify/<run>/state.

import { spawn, execSync } from 'node:child_process';
import { mkdirSync, writeFileSync, rmSync, openSync } from 'node:fs';
import { createServer } from 'node:net';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const WIN = process.platform === 'win32';
const sh = (cmd) => execSync(cmd, { cwd: ROOT, encoding: 'utf8' }).trim();

const RUN_RE = /^\d{8}-\d{6}$/;

// Cleanup finds this run's processes by the run's own state path in their command line,
// so it catches wrangler's children (workerd) even after their parent is gone, and never touches anything else.
// The marker goes in through an environment variable so the query's own command line never matches it.
function runPids(run) {
  if (!WIN) return [];
  const ps = 'Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -and $_.CommandLine.Contains($env:VERIFY_MARK) } | ForEach-Object { $_.ProcessId }';
  return execSync(`powershell -NoProfile -Command "${ps}"`, { encoding: 'utf8', env: { ...process.env, VERIFY_MARK: `.verify\\${run}` } })
    .split(/\s+/).filter(Boolean).map(Number).filter((p) => p !== process.pid);
}

function killRun(run) {
  const marker = `.verify${WIN ? '\\' : '/'}${run}`;
  const killed = [];
  if (WIN) {
    for (const pid of runPids(run)) { try { execSync(`taskkill /pid ${pid} /T /F`, { stdio: 'ignore' }); killed.push(pid); } catch { } }
  } else {
    try { execSync(`pkill -f -- '${marker}'`); killed.push('pkill'); } catch { }
  }
  return killed;
}

async function removeState(dir) {
  for (let i = 0; i < 10; i++) {
    try { rmSync(dir, { recursive: true, force: true }); return true; } catch { await new Promise((r) => setTimeout(r, 500)); }
  }
  return false;
}

// leftover check: anything of this run still alive after cleanup is a cleanup bug
function stillRunning(run) {
  if (!WIN) { try { execSync(`pgrep -f -- '.verify/${run}'`); return 1; } catch { return 0; } }
  return runPids(run).length;
}

// ---------- stop mode ----------
if (process.argv[2] === 'stop') {
  const run = process.argv[3];
  if (!RUN_RE.test(run || '')) { console.error('Usage: node scripts/verify.mjs stop <run id like 20261112-191247>'); process.exit(2); }
  const killed = killRun(run);
  rmSync(join(ROOT, '.verify', run, 'server.pid'), { force: true });
  const gone = await removeState(join(ROOT, '.verify', run, 'state'));
  const left = stillRunning(run);
  console.log(`Stopped run ${run}: killed ${killed.length} process(es), ${left} left, state ${gone ? 'removed' : 'NOT removed'} (evidence kept)`);
  process.exit(left || !gone ? 1 : 0);
}

const KEEP = process.argv.includes('--keep');
const RUN = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, '').replace('T', '-');
const DIR = join(ROOT, '.verify', RUN), STATE = join(DIR, 'state');
mkdirSync(DIR, { recursive: true });

const results = [];
const meta = { run: RUN, startedAt: new Date().toISOString() };
let server = null;

function freePort(start) {
  return new Promise((resolve) => {
    const s = createServer();
    s.once('error', () => resolve(freePort(start + 1)));
    s.once('listening', () => s.close(() => resolve(start)));
    s.listen(start, '127.0.0.1');
  });
}

// one recorded check
function check(feature, name, pass, detail) {
  results.push({ feature, name, pass: !!pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  [${feature}] ${name}${pass ? '' : '  -> ' + JSON.stringify(detail)}`);
}

async function main() {
  // ---------- base ----------
  meta.commit = sh('git rev-parse HEAD');
  meta.dirty = sh('git status --short') || '(clean)';
  meta.node = process.version;
  meta.wrangler = sh('npx wrangler --version');

  // ---------- launch ----------
  const PORT = await freePort(8790);
  const BASE = `http://127.0.0.1:${PORT}`;
  meta.base = BASE;
  sh(`npx wrangler d1 execute drift-sea --local --persist-to "${STATE}" --file=schema.sql`);
  const log = openSync(join(DIR, 'wrangler.log'), 'w');
  // run the repo's own wrangler with node directly: no npx/shell layer whose pid would outlive nothing useful
  server = spawn(process.execPath, [join(ROOT, 'node_modules', 'wrangler', 'bin', 'wrangler.js'), 'dev',
    '--port', String(PORT), '--ip', '127.0.0.1', '--persist-to', STATE, '--var', `IP_SALT:verify-${RUN}`],
  { cwd: ROOT, detached: true, windowsHide: true, stdio: ['ignore', log, log] });
  server.unref();
  meta.pid = server.pid;
  writeFileSync(join(DIR, 'server.pid'), String(server.pid));

  const deadline = Date.now() + 90_000;
  let ready = false;
  while (Date.now() < deadline) {
    try { const r = await fetch(BASE + '/api/fish'); if (r.ok) { ready = true; break; } } catch { }
    await new Promise((r) => setTimeout(r, 1000));
  }
  check('launch', 'server answers GET /api/fish within 90s', ready, { base: BASE });
  if (!ready) throw new Error('server never became ready, see wrangler.log');

  // ---------- doctor ----------
  const page = await fetch(BASE + '/');
  const html = await page.text();
  check('doctor', 'GET / serves the Drift Sea page', page.ok && html.includes('<canvas id="ui"'), { status: page.status });
  const empty = await (await fetch(BASE + '/api/fish')).json();
  // a brand-new database proves this is our instance, not the live site or someone else's dev server
  check('doctor', 'sea starts empty (fresh private database)', Array.isArray(empty.fish) && empty.fish.length === 0, empty);

  // ---------- drive ----------
  const TOKEN = 'verify-token-' + RUN.replace(/\D/g, '');
  let ipN = 0;
  const nextIp = () => `203.0.113.${++ipN}`;   // TEST-NET addresses, one per check unless the check is about the same person
  const post = async (path, body, { ip = nextIp(), token = TOKEN, raw } = {}) => {
    const r = await fetch(BASE + path, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-visitor': token, 'cf-connecting-ip': ip },
      body: raw ?? JSON.stringify(body),
    });
    return { status: r.status, body: await r.json().catch(() => null) };
  };
  const list = async () => (await (await fetch(BASE + '/api/fish')).json()).fish;
  const id = (s) => (s + RUN.replace(/\D/g, '')).toLowerCase().slice(0, 24);

  // release
  const ipA = nextIp();
  let r = await post('/api/fish', { id: id('ok'), text: '  a   quiet  whale sings  ' }, { ip: ipA });
  check('release', 'valid sentence -> 201', r.status === 201, r);
  check('release', 'whitespace collapsed and trimmed', r.body?.fish?.text === 'a quiet whale sings', r.body);
  let fish = await list();
  check('release', 'released fish appears in GET /api/fish', fish.some((f) => f.id === id('ok')), fish);
  check('release', 'list never exposes ip', fish.every((f) => !('ip' in f)), fish[0]);

  r = await post('/api/fish', { id: id('fast'), text: 'too soon' }, { ip: ipA });
  check('release', 'same person within 15s -> 429 slow_down', r.status === 429 && r.body?.error === 'slow_down', r);

  r = await post('/api/fish', { id: id('ok'), text: 'same id again' });
  check('release', 'duplicate id -> 409', r.status === 409 && r.body?.error === 'duplicate', r);

  r = await post('/api/fish', { id: id('emoji'), text: '🐋'.repeat(60) });
  check('release', '60 emoji counts as 60 characters -> 201', r.status === 201, r);
  r = await post('/api/fish', { id: id('long'), text: 'x'.repeat(61) });
  check('release', '61 characters -> 400 length', r.status === 400 && r.body?.error === 'length', r);
  r = await post('/api/fish', { id: id('blank'), text: '    ' });
  check('release', 'blank -> 400 length', r.status === 400 && r.body?.error === 'length', r);

  r = await post('/api/fish', { id: id('badtok'), text: 'hello' }, { token: 'short' });
  check('release', 'bad visitor token -> 400', r.status === 400 && r.body?.error === 'bad_request', r);
  r = await post('/api/fish', { id: 'BAD ID', text: 'hello' });
  check('release', 'bad id -> 400', r.status === 400 && r.body?.error === 'bad_request', r);
  r = await post('/api/fish', null, { raw: '{not json' });
  check('release', 'malformed JSON -> 400', r.status === 400 && r.body?.error === 'bad_request', r);

  // moderation
  for (const [label, text] of [['link', 'see https://x.co'], ['www', 'go www.fish'], ['domain', 'visit fish.com'],
    ['email', 'mail a@b.org now'], ['digits', 'call 4165551234']]) {
    r = await post('/api/fish', { id: id('mod' + label), text });
    check('moderation', `${label} refused -> 422 blocked`, r.status === 422 && r.body?.error === 'blocked', r);
  }
  r = await post('/api/fish', { id: id('version'), text: 'reef version 2.0 is up' });
  check('moderation', 'plain sentence with a number is allowed', r.status === 201, r);

  // report
  const target = id('ok');
  const ipR = nextIp();
  r = await post('/api/report', { id: target }, { ip: ipR });
  await post('/api/report', { id: target }, { ip: ipR });   // same person twice counts once
  await post('/api/report', { id: target });
  fish = await list();
  check('report', 'two different reporters (one repeated) keep it in the sea', fish.some((f) => f.id === target), { ids: fish.map((f) => f.id) });
  await post('/api/report', { id: target });
  fish = await list();
  check('report', 'third different reporter takes it out of the sea', !fish.some((f) => f.id === target), { ids: fish.map((f) => f.id) });
  r = await post('/api/report', { id: 'NOPE!' });
  check('report', 'bad id -> 400', r.status === 400, r);

  // routing
  const nf = await fetch(BASE + '/api/nothing');
  check('routing', 'unknown /api path -> 404 json', nf.status === 404, { status: nf.status });
}

function writeEvidence(error) {
  meta.finishedAt = new Date().toISOString();
  const failed = results.filter((x) => !x.pass);
  meta.verdict = error ? 'BLOCKED' : failed.length ? 'FAIL' : 'PASS';
  if (error) meta.error = String(error.message || error);
  writeFileSync(join(DIR, 'results.json'), JSON.stringify({ meta, results }, null, 2));
  const rows = results.map((x) => `| ${x.pass ? 'PASS' : '**FAIL**'} | ${x.feature} | ${x.name} |`).join('\n');
  writeFileSync(join(DIR, 'summary.md'), `# Drift Sea verification ${RUN}

**Verdict: ${meta.verdict}** (${results.length - failed.length}/${results.length} checks passed)${meta.error ? `\n\nBlocked: ${meta.error}` : ''}

- Commit: \`${meta.commit}\`
- Uncommitted changes: ${meta.dirty === '(clean)' ? 'none' : '\n```\n' + meta.dirty + '\n```'}
- Node ${meta.node}, wrangler ${meta.wrangler}
- Server: ${meta.base} (pid ${meta.pid})${KEEP ? ' — left running for a browser check' : ''}

| Result | Feature | Check |
|---|---|---|
${rows}

Raw requests and responses: results.json. Server output: wrangler.log.
`);
  console.log(`\n${meta.verdict}  ${results.length - failed.length}/${results.length}  evidence: .verify/${RUN}/summary.md`);
}

let error = null;
try { await main(); } catch (e) { error = e; console.error(e); }
writeEvidence(error);

// ---------- cleanup ----------
if (server && !(KEEP && !error)) {
  const killed = killRun(RUN);
  rmSync(join(DIR, 'server.pid'), { force: true });
  const gone = await removeState(STATE);
  const left = stillRunning(RUN);
  console.log(`Cleanup: killed ${killed.length} process(es), ${left} left, state ${gone ? 'removed' : 'NOT removed'}`);
  if (left || !gone) { console.error('CLEANUP INCOMPLETE'); process.exit(3); }
} else if (KEEP) {
  console.log(`Server left up at ${meta.base}. Stop it with: node scripts/verify.mjs stop ${RUN}`);
}
process.exit(error ? 2 : results.every((x) => x.pass) ? 0 : 1);
