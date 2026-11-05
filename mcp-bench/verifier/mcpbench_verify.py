"""mcp-bench verifier SDK (stdlib only).

A verifier inspects real state through an independent surface (the REST API, a database, the file
system), never through the MCP tool under test and never through the agent's narrative. It records
named checks and prints the one JSON line mcp-bench reads:

    {"pass": bool, "details": {"checks": [...], "duplicates": int, "unexpected_mutations": int}}

`duplicates` and `unexpected_mutations` feed the duplicate-side-effect and unexpected-mutation
rates in the report, so call assert_no_duplicates / assert_no_unexpected_mutations whenever the
task can create or change things.

    from mcpbench_verify import Verifier
    v = Verifier()
    v.assert_count("tagged dashboards", dashboards, 1)
    v.assert_no_duplicates("insight names", insights, key=lambda i: i["name"])
    v.finish()
"""
import json
import sys
import time

_MISSING = object()


def _short(x, n=300):
    s = x if isinstance(x, str) else json.dumps(x, default=str, sort_keys=True)
    return s if len(s) <= n else s[: n - 3] + "..."


def _clip(v):
    """Keep small values as-is (lists stay lists); clip large ones to a short string."""
    if isinstance(v, (int, float, bool, type(None))):
        return v
    return v if len(json.dumps(v, default=str)) <= 2000 and not isinstance(v, str) or (isinstance(v, str) and len(v) <= 300) else _short(v)


class Verifier:
    def __init__(self):
        self.checks = []
        self.duplicates = 0
        self.unexpected_mutations = 0
        self.extra = {}

    # -- recording -------------------------------------------------------------------------
    def check(self, name, ok, **info):
        self.checks.append({"name": name, "ok": bool(ok), **{k: _clip(v) for k, v in info.items()}})
        return bool(ok)

    def note(self, **kv):
        """Attach extra details (not checks) to the verdict."""
        self.extra.update(kv)

    @property
    def passed(self):
        return bool(self.checks) and all(c["ok"] for c in self.checks)

    # -- assertions ------------------------------------------------------------------------
    def assert_exists(self, name, value):
        """Passes if value is not None and not empty."""
        return self.check(name, value is not None and value != [] and value != {} and value != "", kind="exists")

    def assert_absent(self, name, value):
        """Passes if value is None or empty (e.g. a search that must return nothing)."""
        return self.check(name, value is None or value in ([], {}, ""), kind="absent", found=value if value else None)

    def assert_equals(self, name, actual, expected):
        return self.check(name, actual == expected, kind="equals", actual=actual, expected=expected)

    def assert_count(self, name, items, n):
        k = len(items)
        return self.check(name, k == n, kind="count", actual=k, expected=n)

    def assert_no_duplicates(self, name, items, key=lambda x: x):
        """Each key at most once. Every extra copy counts toward `duplicates`."""
        seen, dup = {}, 0
        for it in items:
            k = key(it)
            seen[k] = seen.get(k, 0) + 1
        dup = sum(c - 1 for c in seen.values() if c > 1)
        self.duplicates += dup
        return self.check(name, dup == 0, kind="no_duplicates", extra_copies=dup, keys=sorted(str(k) for k, c in seen.items() if c > 1) or None)

    def assert_no_unexpected_mutations(self, name, before, after, allowed_ids=(), ignore_fields=()):
        """before/after: {id: snapshot dict}. Changes are only allowed on `allowed_ids`; fields in
        `ignore_fields` (timestamps, versions) are not compared. Created, deleted and changed ids
        outside the allowed set each count toward `unexpected_mutations`."""
        allowed, ign = {str(i) for i in allowed_ids}, set(ignore_fields)
        strip = lambda d: {k: v for k, v in (d or {}).items() if k not in ign}  # noqa: E731
        b = {str(k): v for k, v in before.items()}
        a = {str(k): v for k, v in after.items()}
        created = sorted(k for k in a.keys() - b.keys() if k not in allowed)
        deleted = sorted(k for k in b.keys() - a.keys() if k not in allowed)
        changed = sorted(k for k in a.keys() & b.keys() if k not in allowed and strip(a[k]) != strip(b[k]))
        n = len(created) + len(deleted) + len(changed)
        self.unexpected_mutations += n
        return self.check(name, n == 0, kind="no_unexpected_mutations", created=created or None, deleted=deleted or None, changed=changed or None)

    def assert_eventually(self, name, probe, timeout_s=30.0, interval_s=2.0):
        """Poll probe() -> (ok, info) until ok or timeout (bounded; for eventually-consistent reads).
        Returns the last info."""
        deadline, tries, info = time.monotonic() + timeout_s, 0, None
        while True:
            tries += 1
            ok, info = probe()
            if ok or time.monotonic() + interval_s > deadline:
                self.check(name, ok, kind="eventually", tries=tries, info=info)
                return info
            time.sleep(interval_s)

    # -- output ----------------------------------------------------------------------------
    def result(self):
        return {"pass": self.passed, "details": {"checks": self.checks, "duplicates": self.duplicates, "unexpected_mutations": self.unexpected_mutations, **self.extra}}

    def finish(self):
        """Print the verdict line and exit 0 (the verdict is in the JSON, not the exit code)."""
        sys.stdout.write(json.dumps(self.result(), default=str) + "\n")
        sys.stdout.flush()
        sys.exit(0)
