"""Soft-delete everything this attempt's tag touched (dashboards, then insights)."""
import os, sys
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "_lib"))
import ph  # noqa: E402

print({"dashboards": ph.soft_delete_tagged("dashboards"), "insights": ph.soft_delete_tagged("insights")})
