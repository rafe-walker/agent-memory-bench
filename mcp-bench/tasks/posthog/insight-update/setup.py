"""Start state: one saved trends insight with a known name, description and query; snapshot kept."""
import os, sys
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "_lib"))
import ph  # noqa: E402

t = ph.tag()
q = {"kind": "InsightVizNode", "source": {"kind": "TrendsQuery", "series": [{"kind": "EventsNode", "event": "$pageview", "math": "total"}]}}
i = ph.api("POST", "insights", {"name": f"{t} subject", "description": "before", "saved": True, "query": q})
i = ph.api("GET", f"insights/{i['id']}")
ph.write_state({
    "project_id": ph.PROJECT, "insight_id": i["id"], "short_id": i["short_id"], "name": i["name"],
    "new_description": f"updated by {t}",
    "before": ph.snapshot([i], ["name", "description", "query", "saved", "deleted", "tags", "favorited", "dashboards"]),
})
