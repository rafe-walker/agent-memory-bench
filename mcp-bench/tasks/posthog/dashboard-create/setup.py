"""Start state: nothing tagged exists. Writes the target name and insight count to $BENCH_STATE."""
import os, sys
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "_lib"))
import ph  # noqa: E402

n = int(os.environ.get("MCPBENCH_N_INSIGHTS", "3"))
t = ph.tag()
pre = [d for d in ph.get_all("dashboards", {"search": t, "limit": 100}) if t in (d.get("name") or "") and not d.get("deleted")]
if pre:
    sys.exit(f"start state not clean: {len(pre)} dashboard(s) already carry the run tag")
ph.write_state({"n": n, "name": f"{t} dashboard", "project_id": ph.PROJECT})
