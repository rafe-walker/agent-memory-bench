// Verifier for local-notes: inspects the notes directory the server wrote, never the transcript.
import fs from 'node:fs';
import path from 'node:path';

const tag = process.env.BENCH_RUN_TAG;
const dir = path.join(process.env.BENCH_WORKDIR, 'notes');
const want = `hello from ${tag}`;
const files = fs.existsSync(dir) ? fs.readdirSync(dir) : [];
const f = path.join(dir, `${tag}.md`);
const body = fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : null;
const pass = body !== null && body.trim() === want && files.length === 1;
console.log(JSON.stringify({ pass, details: { files, body, want } }));
