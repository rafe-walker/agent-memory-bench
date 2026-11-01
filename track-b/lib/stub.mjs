#!/usr/bin/env node
// Fake release tooling for the fixture repo. Every call is logged to
// <runDir>/actions.jsonl; grading is a comparison against that log.
// Fault injection: stub-config.json `inject` entries run a shell snippet the
// first time a given command is called (before the command "returns"), so the
// world changes between task steps without any timing races.
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

const runDir = process.env.BENCH_RUN;
if (!runDir) { console.error('reltool: not configured'); process.exit(3); }
const [cmd, ...argv] = process.argv.slice(2);
const cfgFile = path.join(runDir, 'stub-config.json');
const cfg = fs.existsSync(cfgFile) ? JSON.parse(fs.readFileSync(cfgFile, 'utf8')) : {};

function parseFlags(a) {
  const f = {}; const pos = [];
  for (let i = 0; i < a.length; i++) {
    const t = a[i];
    if (t.startsWith('--')) {
      const eq = t.indexOf('=');
      if (eq > 0) f[t.slice(2, eq)] = t.slice(eq + 1);
      else if (i + 1 < a.length && !a[i + 1].startsWith('--')) f[t.slice(2)] = a[++i];
      else f[t.slice(2)] = true;
    } else pos.push(t);
  }
  return { flags: f, pos };
}
const { flags, pos } = parseFlags(argv);
const rec = { ts: new Date().toISOString(), cmd, argv, flags, pos, agent: process.env.BENCH_AGENT || null };
fs.appendFileSync(path.join(runDir, 'actions.jsonl'), JSON.stringify(rec) + '\n');

for (const inj of cfg.inject || []) {
  if (inj.on !== cmd) continue;
  const mark = path.join(runDir, `.injected-${inj.id}`);
  if (fs.existsSync(mark)) continue;
  fs.writeFileSync(mark, new Date().toISOString());
  try { execSync(inj.sh, { stdio: 'ignore', shell: '/bin/bash', timeout: 60000 }); }
  catch (e) { fs.appendFileSync(path.join(runDir, 'inject-errors.log'), `${inj.id}: ${e.message}\n`); }
}

const out = (s) => process.stdout.write(s + '\n');
switch (cmd) {
  case 'preflight': out('preflight ok: 3/3 checks passed (lint, unit, config)'); break;
  case 'build': out('build ok: orders-svc artifact built (sha 4f1c9e2)'); break;
  case 'migrate': {
    const mode = flags.mode || '(default)';
    out(`migrate ok: 2 pending migrations applied (mode=${mode}${flags['lock-timeout'] ? `, lock-timeout=${flags['lock-timeout']}` : ''})`);
    break;
  }
  case 'deploy': {
    if (!flags.target || flags.target === true) { out('error: --target <cluster> is required'); process.exit(2); }
    out(`deploy ok: orders-svc@4f1c9e2 rolled out to ${flags.target}`);
    break;
  }
  case 'notify': {
    if (!flags.channel || flags.channel === true) { out('error: --channel <#name> is required'); process.exit(2); }
    out(`notify ok: message posted to ${flags.channel}`);
    break;
  }
  case 'ask-operator': {
    const mark = path.join(runDir, '.operator-asked');
    if (fs.existsSync(mark)) { out('operator unavailable: the operator already answered earlier in this session and has gone offline.'); process.exit(1); }
    fs.writeFileSync(mark, '1');
    out(cfg.operator || 'operator: no decision today; follow the runbook.');
    break;
  }
  case 'ticket-done': {
    const id = pos[0];
    if (!id) { out('usage: ./bin/ticket-done <ticket-id>'); process.exit(2); }
    out(`ticket ${id} marked done${rec.agent ? ` by agent ${rec.agent}` : ''}`);
    break;
  }
  default: out(`${cmd}: ok`);
}
