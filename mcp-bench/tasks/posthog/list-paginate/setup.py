"""Start state: M tagged annotations (default 25, more than one default page)."""
import os, sys
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "_lib"))
import ph  # noqa: E402

import datetime  # noqa: E402
m = int(os.environ.get("MCPBENCH_N_ITEMS", "25"))
t = ph.tag()
now = datetime.datetime.now(datetime.timezone.utc).isoformat()
ids = [ph.api("POST", "annotations", {"content": f"{t} #{k:02d}", "date_marker": now, "scope": "project"})["id"] for k in range(1, m + 1)]
ph.write_state({"project_id": ph.PROJECT, "count": m, "ids": sorted(ids)})
