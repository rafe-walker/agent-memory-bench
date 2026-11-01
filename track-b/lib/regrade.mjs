#!/usr/bin/env node
// Recompute transcript-derived DIAGNOSTIC fields (exposed / reground_after_fault /
// read_truth / read_memory / peeked) from the saved stream-json transcripts.
// Outcome fields (success, wrong_action, collisions) come from the stub log and
// git state at run time and are never touched here. Do not run while a runner
// is appending to runs.jsonl.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { RESULTS, readJsonl } from './common.mjs';
import { midDiagnostics, t5Diagnostics, actionText } from '../scenarios/index.mjs';

const PEEK = /stub-config|stub\.mjs|\/pending\/|\.injected-|actions\.jsonl|\/kl\/|docs-src/;
function toolCalls(key, agent) {
  const f = path.join(RESULTS, 'transcripts', `${key.replace(/\|/g, '__')}__${agent}.jsonl.gz`);
  const calls = [];
  for (const line of zlib.gunzipSync(fs.readFileSync(f)).toString('utf8').split('\n')) {
    let m; try { m = JSON.parse(line); } catch { continue; }
    if (m.type === 'assistant' && Array.isArray(m.message?.content)) for (const c of m.message.content) if (c.type === 'tool_use') calls.push({ name: c.name, input: c.input });
  }
  return calls;
}
const file = path.join(RESULTS, 'runs.jsonl');
const rows = readJsonl(file);
let changed = 0;
for (const r of rows) {
  const per = r.agents.map((a) => toolCalls(r.key, a.agent));
  const before = JSON.stringify(r);
  r.peeked = per.some((cs) => cs.some((c) => PEEK.test(actionText(c))));
  if (r.scenario === 'T1' || r.scenario === 'T6') Object.assign(r, midDiagnostics(r.arm, per[0]));
  if (r.scenario === 'T5') Object.assign(r, t5Diagnostics(per[0]));
  r.regraded = 'diagnostics-v2';
  if (JSON.stringify(r) !== before) changed++;
}
fs.writeFileSync(file + '.tmp', rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
fs.renameSync(file + '.tmp', file);
console.log(`regraded diagnostics on ${rows.length} runs (${changed} rows updated)`);
