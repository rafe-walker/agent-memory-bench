#!/usr/bin/env node
// Minimal stdio MCP server (newline-delimited JSON-RPC, no deps) for a near-$0 live smoke test of
// the whole runner path. Notes are files under <cwd>/notes/. NOTES_VERBOSE=1 makes every result echo
// the full note list (a deliberately chatty response, so the two arms differ in tool-result bytes).
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';

const dir = path.join(process.cwd(), 'notes');
const verbose = process.env.NOTES_VERBOSE === '1';
const tools = [
  { name: 'write_note', description: 'Create or overwrite a note.', inputSchema: { type: 'object', properties: { name: { type: 'string', pattern: '^[A-Za-z0-9._-]+$' }, body: { type: 'string' } }, required: ['name', 'body'] } },
  { name: 'list_notes', description: 'List note names.', inputSchema: { type: 'object', properties: {} } },
];
const listing = () => (fs.existsSync(dir) ? fs.readdirSync(dir).map((f) => ({ name: f.replace(/\.md$/, ''), bytes: fs.statSync(path.join(dir, f)).size })) : []);
const text = (o) => ({ content: [{ type: 'text', text: typeof o === 'string' ? o : JSON.stringify(o, null, verbose ? 2 : 0) }] });

function call(name, args) {
  if (name === 'write_note') {
    if (!/^[A-Za-z0-9._-]+$/.test(args?.name || '') || typeof args?.body !== 'string') return { ...text('invalid arguments: name [A-Za-z0-9._-]+, body string'), isError: true };
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${args.name}.md`), args.body);
    return text(verbose ? { ok: true, written: args.name, request: args, notes: listing() } : `ok ${args.name}`);
  }
  if (name === 'list_notes') return text(listing());
  return { ...text(`unknown tool ${name}`), isError: true };
}

const send = (o) => process.stdout.write(JSON.stringify(o) + '\n');
readline.createInterface({ input: process.stdin }).on('line', (line) => {
  let m; try { m = JSON.parse(line); } catch { return; }
  if (m.id === undefined) return; // notification
  if (m.method === 'initialize') send({ jsonrpc: '2.0', id: m.id, result: { protocolVersion: m.params?.protocolVersion || '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'bench-notes', version: '0.1.0' } } });
  else if (m.method === 'tools/list') send({ jsonrpc: '2.0', id: m.id, result: { tools } });
  else if (m.method === 'tools/call') send({ jsonrpc: '2.0', id: m.id, result: call(m.params?.name, m.params?.arguments) });
  else if (m.method === 'ping') send({ jsonrpc: '2.0', id: m.id, result: {} });
  else send({ jsonrpc: '2.0', id: m.id, error: { code: -32601, message: `method not found: ${m.method}` } });
});
