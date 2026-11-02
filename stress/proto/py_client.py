"""Drive kronicle-lite and sea-lite with the official Python MCP SDK (`pip install mcp`, what Hermes
Agent uses): stdio and Streamable HTTP, connect modes auto and legacy, every tool once, and the
SDK's own structuredContent validation in the loop. Usage: python py_client.py <bin dir>
Tokens are read from the server's data dir and never printed."""
import asyncio, json, os, shutil, socket, subprocess, sys, tempfile, time
import mcp
from mcp import StdioServerParameters
from mcp.client.streamable_http import streamable_http_client, create_mcp_http_client

BIN = sys.argv[1] if len(sys.argv) > 1 else "/tmp/claude-0/proto/node_modules/.bin"
RESULTS = []

def check(name, ok, detail=""):
    RESULTS.append(ok)
    print(("PASS " if ok else "FAIL ") + name + ((" — " + str(detail)[:300]) if detail else ""), flush=True)

def env_for(home):
    e = dict(os.environ, HOME=home, KRONICLE_LITE_DATA_DIR=os.path.join(home, "data"), SEA_LITE_ACTOR="py", SEA_LITE_SESSION="py")
    e.pop("CLAUDE_CODE_SESSION_ID", None)
    return e

async def tour(which, call):
    done = []
    async def step(name, args):
        r = await call(name, args)
        done.append((name, r["isError"]))
        return r["sc"] or {}
    if which == "kl":
        await step("put_document", {"slug": "tour", "title": "Tour", "markdown": "# Tour\n\nThe port is 8080.\n\nNever deploy on Friday."})
        st = await step("get_system_state", {"response_format": "json"})
        rc = await step("recall", {"query": "port", "cursor": st.get("cursor")})
        hit = (rc.get("hits") or [{}])[0]
        await step("verify", {"receipt_id": hit.get("receipt_id")})
        await step("audit_assumptions", {"claims": [{"symbol": "port", "value": 8080}]})
        sup = await step("supersede_block", {"block_id": hit.get("block_id"), "new_content": "The port is 9090.", "reason": "moved"})
        await step("tombstone_block", {"block_id": sup.get("new_block_id"), "reason": "gone"})
        await step("get_system_state", {"response_format": "json", "since_cursor": st.get("cursor"), "focus": "retractions"})
        for n in ("verify_chain", "checkpoint_chain", "anchor_status"):
            await step(n, {})
    else:
        c = await step("sea_create", {"title": "py one", "status": "triaged", "claim_seconds": 600})
        tid = c["ticket"]["id"]; tok = (c.get("claim") or {}).get("claim_token") or c.get("claim_token")
        ap = await step("sea_apply", {"tickets": [{"ref": "a", "title": "py a", "status": "triaged"}, {"ref": "b", "title": "py b", "status": "triaged"}], "links": [{"from_ref": "a", "to_ref": "b", "link_type": "depends_on"}]})
        ia, ib = list(ap["created"].values())
        await step("sea_refresh", {"ticket_id": tid, "claim_token": tok})
        await step("sea_update", {"ticket_id": tid, "claim_token": tok, "note": "progress"})
        await step("sea_link", {"action": "add", "from_id": tid, "to_id": ia, "link_type": "relates_to", "claim_token": tok})
        await step("sea_transition", {"ticket_id": tid, "claim_token": tok, "to": "in_progress"})
        await step("sea_finish", {"ticket_id": tid, "claim_token": tok, "outcome": "done", "note": "finished"})
        cl = await step("sea_claim", {"ticket_ids": [ib], "scope": {"paths": ["src/x.ts"]}})
        await step("sea_scope_check", {"paths": ["src/x.ts"]})
        await step("sea_release", {"ticket_id": ib, "claim_token": cl["claims"][0]["claim_token"]})
        nx = await step("sea_next", {})
        await step("sea_get", {"id": (nx.get("ticket") or {}).get("id") or ia})
        await step("sea_list", {"view": "full"})
        await step("sea_history", {"limit": 20})
        await step("sea_stats", {})
    return done

async def exercise(label, which, client):
    errors = []
    async def call(name, args):
        try:
            r = await client.call_tool(name, args)
            sc = getattr(r, "structuredContent", None) or getattr(r, "structured_content", None)
            return {"sc": sc, "isError": bool(getattr(r, "isError", False) or getattr(r, "is_error", False))}
        except Exception as e:  # noqa: BLE001
            errors.append(f"{name}: {type(e).__name__}: {str(e)[:200]}")
            return {"sc": {}, "isError": True}
    tools = await client.list_tools()
    tl = getattr(tools, "tools", tools)
    check(f"{label}: list_tools", len(tl) >= 10, len(tl))
    done = await tour(which, call)
    check(f"{label}: every tool via the SDK (with its structuredContent validation)", not errors, " | ".join(errors))
    bad = [n for n, e in done if e]
    check(f"{label}: tour has no tool errors", not bad, ",".join(bad))
    t = await client.list_resource_templates()
    check(f"{label}: list_resource_templates", len(getattr(t, "resourceTemplates", getattr(t, "resource_templates", []))) >= 1)
    if which == "kl":
        rr = await client.read_resource("kronicle://docs/tour")
        check(f"{label}: read_resource kronicle://docs/tour", bool(rr.contents and rr.contents[0].text))

def free_port():
    s = socket.socket(); s.bind(("127.0.0.1", 0)); p = s.getsockname()[1]; s.close(); return p

async def main():
    for which in ("kl", "sl"):
        exe = os.path.join(BIN, "kronicle-lite" if which == "kl" else "sea-lite")
        for mode in ("auto", "legacy"):
            home = tempfile.mkdtemp(prefix="proto-py-")
            params = StdioServerParameters(command=exe, args=["serve", "--data-dir", os.path.join(home, "data")], env=env_for(home))
            label = f"[{which} py stdio mode={mode}]"
            try:
                async with mcp.Client(params, mode=mode, raise_exceptions=True) as client:
                    check(f"{label}: connected ({client.protocol_version})", True)
                    await exercise(label, which, client)
            except Exception as e:  # noqa: BLE001
                check(f"{label}: session", False, f"{type(e).__name__}: {e}")
            shutil.rmtree(home, ignore_errors=True)
        # HTTP
        home = tempfile.mkdtemp(prefix="proto-pyh-")
        port = free_port()
        p = subprocess.Popen([exe, "serve", "--http", "--host", "127.0.0.1", "--port", str(port), "--data-dir", os.path.join(home, "data")], env=env_for(home), stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        tokf = os.path.join(home, "data", "http-bearer.token")
        for _ in range(100):
            if os.path.exists(tokf) and os.path.getsize(tokf) > 0:
                try:
                    socket.create_connection(("127.0.0.1", port), 0.2).close(); break
                except OSError: pass
            time.sleep(0.1)
        token = open(tokf).read().strip()
        url = f"http://127.0.0.1:{port}/mcp"
        for mode in ("auto", "legacy"):
            label = f"[{which} py http mode={mode}]"
            try:
                async with create_mcp_http_client(headers={"Authorization": f"Bearer {token}"}) as http:
                    async with mcp.Client(streamable_http_client(url, http_client=http), mode=mode, raise_exceptions=True) as client:
                        check(f"{label}: connected ({client.protocol_version})", True)
                        await exercise(label, which, client)
            except Exception as e:  # noqa: BLE001
                check(f"{label}: session", False, f"{type(e).__name__}: {e}")
        # wrong token fails fast
        t0 = time.time()
        try:
            async with create_mcp_http_client(headers={"Authorization": "Bearer wrong-wrong-wrong-wrong"}) as http:
                async with mcp.Client(streamable_http_client(url, http_client=http), raise_exceptions=True) as client:
                    await client.list_tools()
            check(f"[{which} py http wrong bearer] refused", False, "connected")
        except Exception as e:  # noqa: BLE001
            check(f"[{which} py http wrong bearer] refused fast", time.time() - t0 < 10, f"{type(e).__name__} in {time.time() - t0:.1f}s")
        p.terminate(); p.wait(5)
        shutil.rmtree(home, ignore_errors=True)
    print(f"\n{sum(RESULTS)}/{len(RESULTS)} passed")
    sys.exit(0 if all(RESULTS) else 1)

if __name__ == "__main__":
    asyncio.run(main())
