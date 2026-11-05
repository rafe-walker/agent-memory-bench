"""Soft-delete the subject insight and anything else carrying the tag."""
import os, sys
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "_lib"))
import ph  # noqa: E402

print({"insights": ph.soft_delete_tagged("insights")})
