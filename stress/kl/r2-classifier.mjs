#!/usr/bin/env node
// Round 2, attack (a): format-only classifier, end to end (put v1 -> cursor -> put v2 -> orient retractions).
// Two oracles for a pair the classifier calls FORMAT-ONLY:
//   cm  : CommonMark (markdown-it 14.1.0, 'commonmark' preset) HTML of old vs new, whitespace-collapsed.
//         Different HTML => the classifier's own contract ("same Markdown tree, identical text") is broken.
//   raw : the case's label. 'S' = a real change for an agent that reads the raw Markdown.
// Any 'S' case classified format-only (not in retractions) is reported. Exit 1 if any.
// usage: KL=<kl checkout> MDIT=<dir containing node_modules/markdown-it> node stress/kl/r2-classifier.mjs [--json] [--only ID] [--mutant NAME]
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { classifyEdit2Cases } from './r2-classifier-cases.mjs';
import { classifyE2E } from './r2-lib.mjs';

const req = createRequire(join(process.env.MDIT ?? process.cwd(), 'noop.js'));
const MarkdownIt = req('markdown-it');
const md = new MarkdownIt('commonmark');
const html = (s) => md.render(s).replace(/\s+/g, ' ').trim();

const args = process.argv.slice(2);
const only = args.includes('--only') ? args[args.indexOf('--only') + 1] : null;
const mutant = args.includes('--mutant') ? args[args.indexOf('--mutant') + 1] : null;
const H = '# Runbook\n\n';
let cases = classifyEdit2Cases.map(([id, label, o, n, note]) => ({ id, label, old: H + o + '\n', new: H + n + '\n', o, n, note }));
if (only) cases = cases.filter((c) => c.id === only);
const res = classifyE2E(cases, { mutants: mutant ? [mutant] : [] });
let bad = 0;
const rows = [];
for (const r of res) {
  const fo = r.in_retractions === 0;
  const cmSame = html(r.o) === html(r.n);
  const verdict = r.any_event === 0 ? 'NO_EVENT' : fo ? 'format_only' : 'retraction';
  const wrong = r.label === 'S' && verdict !== 'retraction';
  const cmBroken = verdict !== 'retraction' && !cmSame;
  if (wrong) bad++;
  rows.push({ id: r.id, label: r.label, verdict, cm_same: cmSame, wrong, cm_contract_broken: cmBroken, note: r.note });
}
if (args.includes('--json')) console.log(JSON.stringify(rows, null, 1));
else {
  for (const r of rows) if (r.wrong || r.cm_contract_broken || only) console.log(`${r.wrong ? 'FALSE-FORMAT-ONLY' : 'cm-diff'} ${r.id} [${r.verdict}] cm_same=${r.cm_same} ${r.note}`);
  const S = rows.filter((r) => r.label === 'S');
  const C = rows.filter((r) => r.label === 'C');
  console.log(`cases=${rows.length} real=${S.length} real-hidden=${S.filter((r) => r.wrong).length} benign=${C.length} benign-quiet=${C.filter((r) => r.verdict !== 'retraction').length} cm-contract-broken=${rows.filter((r) => r.cm_contract_broken).length}${mutant ? ` mutant=${mutant}` : ''}`);
}
process.exit(bad ? 1 : 0);
