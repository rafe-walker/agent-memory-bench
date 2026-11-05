"""Shared helpers for the PostHog task templates: direct REST access for setup, verifier and cleanup.
Stdlib only (urllib honours HTTPS_PROXY / SSL_CERT_FILE). Never prints the key.

Env: POSTHOG_AUDIT_KEY (personal API key, sandbox project only), POSTHOG_PROJECT_ID,
     POSTHOG_HOST (default https://us.posthog.com). BENCH_* vars come from mcp-bench."""
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "..", "verifier"))
from mcpbench_verify import Verifier  # noqa: E402,F401  (re-exported for the task verifiers)

HOST = os.environ.get("POSTHOG_HOST", "https://us.posthog.com").rstrip("/")
PROJECT = os.environ.get("POSTHOG_PROJECT_ID", "")
THROTTLE_S = float(os.environ.get("POSTHOG_THROTTLE_S", "0.6"))


def _key():
    k = os.environ.get("POSTHOG_AUDIT_KEY")
    if not k or not PROJECT:
        sys.exit("POSTHOG_AUDIT_KEY and POSTHOG_PROJECT_ID must be set")
    return k


def api(method, path, body=None, params=None):
    url = path if path.startswith("http") else f"{HOST}/api/projects/{PROJECT}/{path.strip('/')}/"
    if params:
        url += ("&" if "?" in url else "?") + urllib.parse.urlencode(params)
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method, headers={"Authorization": f"Bearer {_key()}", "Content-Type": "application/json"})
    for attempt in range(4):
        time.sleep(THROTTLE_S)
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                raw = r.read()
                return json.loads(raw) if raw else None
        except urllib.error.HTTPError as e:
            if e.code == 429 and attempt < 3:
                time.sleep(int(e.headers.get("Retry-After", "5")))
                continue
            raise RuntimeError(f"{method} {urllib.parse.urlsplit(url).path} -> HTTP {e.code}: {e.read()[:300]!r}") from None


def get_all(path, params):
    out, url, p = [], path, dict(params)
    while url:
        j = api("GET", url, params=p)
        out += j.get("results", [])
        url, p = j.get("next"), None
    return out


def tag():
    return os.environ["BENCH_RUN_TAG"]


def read_state():
    try:
        with open(os.environ["BENCH_STATE"]) as f:
            return json.load(f)
    except FileNotFoundError:
        return {}


def write_state(d):
    with open(os.environ["BENCH_STATE"], "w") as f:
        json.dump(d, f)


def snapshot(items, fields):
    """{id: {field: value}} over a stable field whitelist, for assert_no_unexpected_mutations."""
    return {str(x["id"]): {f: x.get(f) for f in fields} for x in items}


def live_tagged(kind, field="name", extra=None):
    """Live (not soft-deleted) <kind> whose <field> contains this run's tag, read via REST."""
    t = tag()
    return [x for x in get_all(kind, {"search": t, "limit": 100, **(extra or {})}) if not x.get("deleted") and t in (x.get(field) or "")]


def soft_delete_tagged(kind, name_field="name", extra=None):
    """Soft-delete every non-deleted <kind> whose name contains this run's tag. Returns count."""
    t, n = tag(), 0
    for x in get_all(kind, {"search": t, "limit": 100, **(extra or {})}):
        if t in (x.get(name_field) or "") and not x.get("deleted"):
            api("PATCH", f"{kind}/{x['id']}", {"deleted": True})
            n += 1
    return n
