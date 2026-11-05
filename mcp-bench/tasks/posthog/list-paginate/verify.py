"""Independent surface: PostHog REST API. Never reads the agent's text, so the listing is graded
through a required write-back: every tagged annotation (across all pages) must end in ' [seen]'
exactly once, and nothing else may change."""
import os, sys
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "_lib"))
import ph  # noqa: E402

s, v = ph.read_state(), ph.Verifier()
live = ph.live_tagged("annotations", field="content")
after = ph.snapshot(live, ["content", "date_marker", "scope", "deleted"])
want = {k: b["content"] + " [seen]" for k, b in s["before"].items()}
got = {k: a["content"] for k, a in after.items() if k in want}
v.assert_equals("annotations marked (missing = not paginated)", sorted(k for k in want if got.get(k) == want[k]), sorted(want))
v.assert_no_duplicates("annotation contents", live, key=lambda a: a.get("content"))
v.assert_no_unexpected_mutations("no other changes", s["before"], after, ignore_fields=["content"])
v.note(marked=sum(1 for k in want if got.get(k) == want[k]), of=len(want))
v.finish()
