"""Read-only task: ground truth is fetched here from the API and compared with the agent's final
'IDS:' line (BENCH_ANSWER_FILE). Also fails if the tagged set changed (the agent wrote something)."""
import os, sys
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "_lib"))
import ph  # noqa: E402

import re  # noqa: E402
s, t = ph.read_state(), ph.tag()
truth = sorted(a["id"] for a in ph.get_all("annotations", {"search": t, "limit": 100}) if not a.get("deleted") and (a.get("content") or "").startswith(t))
answer = open(os.environ["BENCH_ANSWER_FILE"]).read()
m = re.findall(r"^\s*IDS:\s*(.*)$", answer, re.M)
got = sorted(int(x) for x in re.findall(r"\d+", m[-1])) if m else None
ok = got == truth and truth == s["ids"]
ph.verdict(ok, truth_count=len(truth), got_count=None if got is None else len(got),
           missing=sorted(set(truth) - set(got or [])), extra=sorted(set(got or []) - set(truth)), state_changed=truth != s["ids"])
