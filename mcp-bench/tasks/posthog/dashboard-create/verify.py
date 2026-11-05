"""Pass iff exactly one live dashboard has the exact name, it holds exactly N tiles whose insights are
named '<tag> insight 1..N', and no other live tagged insight exists (no orphans or duplicates)."""
import os, sys
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "_lib"))
import ph  # noqa: E402

s, t = ph.read_state(), ph.tag()
dash = [d for d in ph.get_all("dashboards", {"search": t, "limit": 100}) if not d.get("deleted") and t in (d.get("name") or "")]
exact = [d for d in dash if d.get("name") == s["name"]]
if len(exact) != 1:
    ph.verdict(False, reason="dashboard count", exact_name=len(exact), tagged=[d.get("name") for d in dash])
d = ph.api("GET", f"dashboards/{exact[0]['id']}")
tile_names = sorted((x.get("insight") or {}).get("name") or "" for x in d.get("tiles") or [] if x.get("insight"))
want = sorted(f"{t} insight {k}" for k in range(1, s["n"] + 1))
live = [i for i in ph.get_all("insights", {"search": t, "limit": 100}) if not i.get("deleted") and t in (i.get("name") or "")]
ok = tile_names == want and len(live) == s["n"] and len(dash) == 1
ph.verdict(ok, tiles=tile_names, want=want, live_tagged_insights=len(live), tagged_dashboards=len(dash))
