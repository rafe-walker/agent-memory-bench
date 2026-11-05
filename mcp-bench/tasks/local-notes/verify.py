"""Independent surface: the notes directory on disk (not the MCP server). Never reads the agent's text."""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "verifier"))
from mcpbench_verify import Verifier  # noqa: E402

tag = os.environ["BENCH_RUN_TAG"]
d = os.path.join(os.environ["BENCH_WORKDIR"], "notes")
files = sorted(os.listdir(d)) if os.path.isdir(d) else []
v = Verifier()
f = os.path.join(d, f"{tag}.md")
body = open(f).read().strip() if os.path.exists(f) else None
v.assert_exists("note file", body)
v.assert_equals("note body", body, f"hello from {tag}")
v.assert_no_unexpected_mutations("no other notes", {}, {n: {} for n in files if n != f"{tag}.md"})
v.finish()
