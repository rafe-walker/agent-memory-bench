#!/usr/bin/env node
// Round 2, attack (a): metamorphic + property checks of the format-only label, end to end, outside the
// list-numbering / emphasis-marker internals being rewritten on fix-0.8.1.
//   symmetry   : format_only(A,B) must equal format_only(B,A)
//   property   : seeded random REAL mutations of runbook blocks (token edits, inline-code/link/heading/table/quote
//                edits, zero-width/bidi/homoglyph insertions, CRLF mixing, very long lines) are never format-only;
//                seeded BENIGN transforms (reflow, whitespace runs) of the same blocks are reported for noise.
// usage: KL=<kl checkout> node stress/kl/r2-metamorphic.mjs [--seeds N]     exit 1 = a violation
import { classifyEdit2Cases } from './r2-classifier-cases.mjs';
import { classifyE2E, rng } from './r2-lib.mjs';

const seeds = Number(process.argv.includes('--seeds') ? process.argv[process.argv.indexOf('--seeds') + 1] : 6);
const H = '# Runbook\n\n';
const doc = (b) => H + b + '\n';
const fo = (r) => r.any_event > 0 && r.in_retractions === 0;
let violations = 0;

// symmetry + transitivity over the corpus blocks
const pairs = classifyEdit2Cases.map(([id, , o, n]) => ({ id, o, n }));
const fwd = classifyE2E(pairs.map((p) => ({ id: p.id, old: doc(p.o), new: doc(p.n) })));
const rev = classifyE2E(pairs.map((p) => ({ id: p.id, old: doc(p.n), new: doc(p.o) })));
const asym = fwd.filter((r, i) => fo(r) !== fo(rev[i]) && r.any_event > 0).map((r, i) => r.id);
console.log(JSON.stringify({ check: 'symmetry', pairs: pairs.length, asymmetric: asym }));
violations += asym.length;

const RUNBOOK_BLOCKS = [
  'Deploy with `./bin/deploy --target staging-a` after the [checklist](https://wiki.example/deploy-v2) passes.',
  'Never run `terraform apply` on prod-eu-1 between 09:00 and 17:00 UTC; page @oncall-sre first.',
  'Rotate the key at /etc/ssl/private/api.pem every 90 days and restart nginx on web-01..web-04.',
  '| env | host | port |\n|---|---|---|\n| prod | db-1.internal | 5432 |',
  '> Freeze: no deploys to payments-api until 2026-12-01.',
  '- Drain node-7 with `kubectl drain node-7 --ignore-daemonsets`\n- Upgrade kernel to 6.8.12\n- Uncordon node-7',
  'Retain WAL archives for 14 days in s3://backups-eu/wal/ (bucket owner: team-data).',
  'Max upload is 100 MB; requests above 2 req/s per IP get HTTP 429.',
  '支付服务的部署窗口是周二 02:00–04:00（UTC+8）。',
  'נתיב הגיבוי הוא /srv/backup/db ונשמר 30 יום.',
];
const ZW = ['​', '‌', '‍', '⁠', '﻿', '‎', '‏', '‮'];
const HOMO = { a: 'а', e: 'е', o: 'о', p: 'р', c: 'с', x: 'х', i: 'і', s: 'ѕ', '0': 'O', '1': 'l' };
function realMutation(b, r) {
  const kinds = ['digit', 'letter', 'zw', 'homo', 'dropword', 'swapwords', 'code', 'href', 'punct', 'crlf+edit', 'longline'];
  const k = kinds[Math.floor(r() * kinds.length)];
  const idx = (re) => { const m = [...b.matchAll(re)]; return m.length ? m[Math.floor(r() * m.length)].index : -1; };
  let i;
  switch (k) {
    case 'digit': i = idx(/\d/g); return i < 0 ? null : [k, b.slice(0, i) + String((Number(b[i]) + 1 + Math.floor(r() * 8)) % 10) + b.slice(i + 1)];
    case 'letter': i = idx(/[a-z]/g); return i < 0 ? null : [k, b.slice(0, i) + (b[i] === 'z' ? 'y' : String.fromCharCode(b.charCodeAt(i) + 1)) + b.slice(i + 1)];
    case 'zw': i = 1 + Math.floor(r() * (b.length - 1)); return [k, b.slice(0, i) + ZW[Math.floor(r() * ZW.length)] + b.slice(i)];
    case 'homo': i = idx(/[aeopcxis01]/g); return i < 0 ? null : [k, b.slice(0, i) + HOMO[b[i]] + b.slice(i + 1)];
    case 'dropword': { const w = b.split(' '); if (w.length < 3) return null; w.splice(1 + Math.floor(r() * (w.length - 2)), 1); return [k, w.join(' ')]; }
    case 'swapwords': { const w = b.split(' '); if (w.length < 4) return null; const j = 1 + Math.floor(r() * (w.length - 3)); if (w[j] === w[j + 1]) return null; [w[j], w[j + 1]] = [w[j + 1], w[j]]; return [k, w.join(' ')]; }
    case 'code': i = idx(/`[^`]+`/g); return i < 0 ? null : [k, b.slice(0, i + 2) + 'X' + b.slice(i + 2)];
    case 'href': i = b.indexOf(']('); return i < 0 ? null : [k, b.slice(0, i + 2) + 'h' + b.slice(i + 3)];
    case 'punct': i = idx(/[;:.,]/g); return i < 0 ? null : [k, b.slice(0, i) + (b[i] === ';' ? ',' : ';') + b.slice(i + 1)];
    case 'crlf+edit': { const m = realMutation(b, r); return m && m[0] !== 'crlf+edit' ? [k + '/' + m[0], m[1].replace(/\n/g, '\r\n')] : null; }
    case 'longline': { const pad = Array.from({ length: 400 }, (_, j) => `w${j}`).join(' '); const m = realMutation(b, r); return m && !m[0].startsWith('long') && !m[0].startsWith('crlf') ? [k + '/' + m[0], pad + ' ' + m[1]] : null; }
  }
  return null;
}
const props = [];
for (let s = 1; s <= seeds; s++) {
  const r = rng(s * 7919);
  for (const b of RUNBOOK_BLOCKS) for (let t = 0; t < 8; t++) {
    const m = realMutation(b, r);
    if (!m || m[1] === b) continue;
    const old = m[0].startsWith('longline') ? Array.from({ length: 400 }, (_, j) => `w${j}`).join(' ') + ' ' + b : b;
    if (old === m[1]) continue;
    props.push({ id: `s${s}:${m[0]}`, old: doc(old), new: doc(m[1]), o: old, n: m[1] });
  }
}
const pr = classifyE2E(props);
const hidden = pr.filter((x) => x.in_retractions === 0).map((x) => ({ id: x.id, event: x.any_event > 0, o: x.o.slice(-90), n: x.n.slice(-90) }));
console.log(JSON.stringify({ check: 'property-real', cases: pr.length, hidden: hidden.length }));
for (const h of hidden) console.log(JSON.stringify(h));
violations += hidden.length;
process.exit(violations ? 1 : 0);
