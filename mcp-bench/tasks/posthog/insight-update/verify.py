"""Independent surface: PostHog REST API. Never reads the agent's text. Pass iff the description is
exactly the new value, every other snapshotted field is unchanged, and nothing else was created."""
import os, sys
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "_lib"))
import ph  # noqa: E402

s, v = ph.read_state(), ph.Verifier()
fields = ["name", "description", "query", "saved", "deleted", "tags", "favorited", "dashboards"]
i = ph.api("GET", f"insights/{s['insight_id']}")
v.assert_eventually("description updated", lambda: (lambda x: (x.get("description") == s["new_description"], x.get("description")))(ph.api("GET", f"insights/{s['insight_id']}")), timeout_s=15, interval_s=3)
v.assert_equals("not deleted", bool(i.get("deleted")), False)
live = ph.live_tagged("insights")
v.assert_no_duplicates("tagged insight names", live, key=lambda x: x.get("name"))
after = ph.snapshot(live, fields)
after[str(i["id"])] = ph.snapshot([i], fields)[str(i["id"])]
v.assert_no_unexpected_mutations("only the description changed", s["before"], after, ignore_fields=["description"])
v.finish()
