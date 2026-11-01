// usage: node tamper-event.cjs <data-dir> <badjson|valid> [needle] [replacement]
const D = require('better-sqlite3');
const [dir, mode, needle = 'stg-east-1', repl = 'stg-evil-9'] = process.argv.slice(2);
const db = new D(dir + '/kronicle-lite.db');
const r = db.prepare('SELECT seq, event_type t, payload_canonical p FROM events WHERE payload_canonical LIKE ? ORDER BY seq DESC LIMIT 1').get('%' + needle + '%');
if (!r) { console.log('no event holds', needle); process.exit(3); }
const p = mode === 'badjson' ? r.p.slice(0, -1) : r.p.split(needle).join(repl);
const ch = db.prepare('UPDATE events SET payload_canonical=? WHERE seq=?').run(p, r.seq).changes;
console.log('tampered seq', r.seq, r.t, mode, 'rows', ch);
