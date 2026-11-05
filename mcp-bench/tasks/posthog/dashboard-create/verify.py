"""Independent surface: PostHog REST API (not the MCP server under test). Never reads the agent's text.
Pass iff exactly one live dashboard has the exact name, its tiles hold exactly the insights
'<tag> insight 1..N', and no other live tagged dashboard or insight exists."""
import os, sys
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "_lib"))
import ph  # noqa: E402

s, t, v = ph.read_state(), ph.tag(), ph.Verifier()
want = sorted(f"{t} insight {k}" for k in range(1, s["n"] + 1))
dash = v.assert_eventually("dashboard visible via REST", lambda: (lambda d: (any(x.get("name") == s["name"] for x in d), d))(ph.live_tagged("dashboards")), timeout_s=20, interval_s=4)
exact = [d for d in dash if d.get("name") == s["name"]]
v.assert_no_duplicates("dashboard names", dash, key=lambda d: d.get("name"))
v.assert_count("dashboards with the exact name", exact, 1)
if exact:
    d = ph.api("GET", f"dashboards/{exact[0]['id']}")
    v.assert_equals("tile insight names", sorted((x.get("insight") or {}).get("name") or "" for x in d.get("tiles") or [] if x.get("insight")), want)
live = ph.live_tagged("insights")
v.assert_no_duplicates("insight names", live, key=lambda i: i.get("name"))
v.assert_count("live tagged insights", live, s["n"])
extra = [x for x in dash if x not in exact[:1]] + [x for x in live if x.get("name") not in want]
v.assert_no_unexpected_mutations("no other tagged resources", {}, ph.snapshot(extra, ["name"]))
v.finish()
