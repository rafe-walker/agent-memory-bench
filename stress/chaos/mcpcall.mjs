#!/usr/bin/env node
// One-shot MCP client: spawn `node CLI serve …ARGS`, run a JSON list of tool calls, print one JSON
// line per call ({tool, isError, result}). usage: node mcpcall.mjs CLI 'serve --data-dir D …' '[["recall",{…}],…]'
import { Mcp } from '../lib/mcp.mjs';
const [cli, args, calls] = process.argv.slice(2);
const m = new Mcp('node', [cli, ...args.split(' ').filter(Boolean)], { timeoutMs: Number(process.env.MCP_TIMEOUT_MS ?? 60000) });
let rc = 0;
try {
  await m.init();
  for (const [tool, a] of JSON.parse(calls)) {
    const r = await m.call(tool, a);
    if (r.error || r.isError) rc = 1;
    console.log(JSON.stringify({ tool, isError: !!(r.error || r.isError), result: r.error ?? r.result }));
  }
} catch (e) { console.log(JSON.stringify({ fatal: String(e), stderr: m.stderr.slice(0, 400) })); rc = 2; }
await m.close();
process.exit(rc);
