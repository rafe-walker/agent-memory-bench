"""Soft-delete this attempt's annotations."""
import os, sys
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "_lib"))
import ph  # noqa: E402

print({"annotations": ph.soft_delete_tagged("annotations", name_field="content")})
