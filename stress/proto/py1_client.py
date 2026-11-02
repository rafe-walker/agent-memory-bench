"""Python MCP SDK 1.x (mcp<2; older Hermes Agent builds): stdio + Streamable HTTP, every tool once.
Reuses py_client.tour. Usage: python py1_client.py <bin dir>"""
import asyncio, os, shutil, socket, subprocess, sys, tempfile, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client
from mcp.client.streamable_http import streamablehttp_client
import py_client as P

async def run(label, which, read, write):
    async with ClientSession(read, write) as s:
        init = await s.initialize()
        P.check(f"{label}: initialized ({init.protocolVersion})", True)
        await P.exercise(label, which, s)

async def main():
    BIN = sys.argv[1] if len(sys.argv) > 1 else "/tmp/claude-0/proto/node_modules/.bin"
    for which in ("kl", "sl"):
        exe = os.path.join(BIN, "kronicle-lite" if which == "kl" else "sea-lite")
        home = tempfile.mkdtemp(prefix="proto-py1-")
        params = StdioServerParameters(command=exe, args=["serve", "--data-dir", os.path.join(home, "data")], env=P.env_for(home))
        try:
            async with stdio_client(params, errlog=open(os.devnull, "w")) as (r, w):
                await run(f"[{which} py1 stdio]", which, r, w)
        except Exception as e:  # noqa: BLE001
            P.check(f"[{which} py1 stdio]: session", False, f"{type(e).__name__}: {e}")
        port = P.free_port()
        p = subprocess.Popen([exe, "serve", "--http", "--host", "127.0.0.1", "--port", str(port), "--data-dir", os.path.join(home, "data")], env=P.env_for(home), stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        tokf = os.path.join(home, "data", "http-bearer.token")
        for _ in range(100):
            try:
                if os.path.getsize(tokf) > 0:
                    socket.create_connection(("127.0.0.1", port), 0.2).close(); break
            except OSError: pass
            time.sleep(0.1)
        token = open(tokf).read().strip()
        try:
            async with streamablehttp_client(f"http://127.0.0.1:{port}/mcp", headers={"Authorization": f"Bearer {token}"}) as (r, w, _):
                await run(f"[{which} py1 http]", which, r, w)
        except Exception as e:  # noqa: BLE001
            P.check(f"[{which} py1 http]: session", False, f"{type(e).__name__}: {e}")
        p.terminate(); p.wait(5)
        shutil.rmtree(home, ignore_errors=True)
    print(f"\n{sum(P.RESULTS)}/{len(P.RESULTS)} passed")
    sys.exit(0 if all(P.RESULTS) else 1)

asyncio.run(main())
