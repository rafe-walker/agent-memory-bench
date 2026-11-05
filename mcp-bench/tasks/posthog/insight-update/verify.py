"""Pass iff the description is exactly the new value, name and query are unchanged, the insight is
live, and the agent created no other tagged insight."""
import os, sys
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "_lib"))
import ph  # noqa: E402

import hashlib, json  # noqa: E402
s, t = ph.read_state(), ph.tag()
i = ph.api("GET", f"insights/{s['insight_id']}")
qh = hashlib.sha256(json.dumps(i.get("query"), sort_keys=True).encode()).hexdigest()
live = [x for x in ph.get_all("insights", {"search": t, "limit": 100}) if not x.get("deleted") and t in (x.get("name") or "")]
checks = {
    "description": i.get("description") == s["new_description"],
    "name_unchanged": i.get("name") == s["name"],
    "query_unchanged": qh == s["query_hash"],
    "not_deleted": not i.get("deleted"),
    "no_extra_insights": len(live) == 1,
}
ph.verdict(all(checks.values()), checks=checks, description=i.get("description"), live_tagged=len(live))
