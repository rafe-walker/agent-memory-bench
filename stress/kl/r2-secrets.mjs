#!/usr/bin/env node
// Round 2, attack (f): secret-guard bypasses with realistic shapes. For each sample: does the write guard refuse
// (default policy) and, if it was stored, does the read-time scrub mask it when recalled?
// A real-looking credential that is stored (chained forever) is reported: write_refused=false.
// The credentials below are synthetic (random characters in the provider's shape), never real.
// usage: KL=<kl checkout> node stress/kl/r2-secrets.mjs
import { mod, openKl } from './r2-lib.mjs';
const R = (n, a = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789') => { let s = '', x = 7; for (let i = 0; i < n; i++) { x = (x * 1103515245 + 12345) >>> 0; s += a[x % a.length]; } return s; };
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const pemBody = Array.from({ length: 4 }, (_, i) => R(64, B64).slice(i) + R(i + 1, B64)).join('\n');
const pem = `-----BEGIN PRIVATE KEY-----\n${pemBody}\n-----END PRIVATE KEY-----`;
const indent = (s, p) => s.split('\n').map((l) => p + l).join('\n');
const pw = `Zq${R(14)}9`;
const SAMPLES = [
  ['P01', 'control: PEM at column 0', `# K\n\n${pem}\n`],
  ['P02', 'PEM indented in a YAML block scalar (k8s Secret)', `# K\n\n\`\`\`yaml\ntls.key: |\n${indent(pem, '    ')}\n\`\`\`\n`],
  ['P03', 'PEM in a block quote', `# K\n\n${indent(pem, '> ')}\n`],
  ['P04', 'PEM inside a list item (indented 2)', `# K\n\n- the key:\n${indent(pem, '  ')}\n`],
  ['C01', 'control: PASSWORD= env line', `# K\n\n\`\`\`\nDB_PASSWORD=${pw}\n\`\`\`\n`],
  ['C02', 'lower snake_case YAML key db_password:', `# K\n\n\`\`\`yaml\ndb_password: ${pw}\n\`\`\`\n`],
  ['C03', 'camelCase JSON key "dbPassword"', `# K\n\n\`\`\`json\n{"dbPassword": "${pw}"}\n\`\`\`\n`],
  ['C04', 'ansible var postgres_password=', `# K\n\n\`\`\`\npostgres_password=${pw}\n\`\`\`\n`],
  ['C05', 'lower env name with export', `# K\n\n\`\`\`sh\nexport db_password=${pw}\n\`\`\`\n`],
  ['C06', 'HTTP header X-Api-Key:', `# K\n\n\`\`\`\ncurl -H "X-Api-Key: ${pw}" https://api.example.net\n\`\`\`\n`],
  ['C07', 'mysql -p<password> on a command line', `# K\n\n\`\`\`\nmysql -u root -p${pw} prod\n\`\`\`\n`],
  ['C08', 'password containing "example" (placeholder rule)', `# K\n\n\`\`\`\nDB_PASSWORD=Kx9${R(6)}example${R(4)}\n\`\`\`\n`],
  ['T01', 'control: github token', `# K\n\nToken ghp_${R(36)}\n`],
  ['T02', 'github token split by a soft hyphen', `# K\n\nToken ghp_${R(18)}­${R(18)}\n`],
];
const rows = [];
for (const [id, note, md] of SAMPLES) {
  const { kl, done } = openKl();
  try {
    let refused = false;
    try { kl.docs.putDocument({ slug: 'k', title: 'K', markdown: md, actor_id: 'w' }); } catch (e) { refused = /secret/i.test(String(e?.code ?? e?.name ?? e)) || /secret/i.test(String(e)); if (!refused) throw e; }
    let served = null;
    if (!refused) {
      const doc = kl.docs.getDocument('k');
      const live = kl.docs.liveBlocks(doc.doc_id).map((b) => b.content).join('\n');
      // What a document read serves (kronicle://docs/<slug>, CLI `get`): the read-time scrub of the stored markdown.
      const text = mod.scrubDeep(kl.docs.getRevisionMarkdown(doc.doc_id, doc.current_revision)).value;
      const secretBits = [pw, pemBody.slice(0, 30), 'ghp_'];
      served = { scrubbed_on_read: !secretBits.some((b) => text.includes(b)), stored_in_chain: secretBits.some((b) => live.includes(b) || live.includes(b.slice(0, 18))) };
    }
    rows.push({ id, note, write_refused: refused, ...served });
  } finally { done(); }
}
for (const r of rows) console.log(JSON.stringify(r));
process.exit(rows.some((r) => !r.write_refused && !/^control/.test(r.note)) ? 1 : 0);
