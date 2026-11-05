import io
import json
import unittest
from contextlib import redirect_stdout

from mcpbench_verify import Verifier


class VerifierSDK(unittest.TestCase):
    def test_basic_assertions(self):
        v = Verifier()
        self.assertTrue(v.assert_exists("e", {"id": 1}))
        self.assertFalse(v.assert_exists("e2", []))
        self.assertTrue(v.assert_absent("a", []))
        self.assertFalse(v.assert_absent("a2", [1]))
        self.assertTrue(v.assert_equals("eq", {"x": 1}, {"x": 1}))
        self.assertFalse(v.assert_count("c", [1, 2], 3))
        self.assertFalse(v.passed)
        self.assertEqual([c["ok"] for c in v.checks], [True, False, True, False, True, False])

    def test_no_checks_is_not_a_pass(self):
        self.assertFalse(Verifier().passed)

    def test_duplicates_count_extra_copies(self):
        v = Verifier()
        self.assertFalse(v.assert_no_duplicates("names", [{"n": "a"}, {"n": "a"}, {"n": "a"}, {"n": "b"}], key=lambda x: x["n"]))
        self.assertEqual(v.duplicates, 2)
        self.assertEqual(v.result()["details"]["duplicates"], 2)

    def test_unexpected_mutations(self):
        v = Verifier()
        before = {1: {"name": "x", "updated_at": "t0"}, 2: {"name": "y"}, 3: {"name": "z"}}
        after = {"1": {"name": "x", "updated_at": "t1"}, "2": {"name": "Y"}, "3": {"name": "Z"}, "4": {"name": "new"}}
        self.assertFalse(v.assert_no_unexpected_mutations("m", before, after, allowed_ids=[3], ignore_fields=["updated_at"]))
        self.assertEqual(v.unexpected_mutations, 2)  # 2 changed, 4 created; 1 only touched an ignored field; 3 allowed
        c = v.checks[-1]
        self.assertEqual(c["changed"], ["2"])
        self.assertEqual(c["created"], ["4"])
        self.assertIsNone(c["deleted"])

    def test_eventually_is_bounded(self):
        v = Verifier()
        calls = []
        info = v.assert_eventually("never", lambda: (calls.append(1) or False, len(calls)), timeout_s=0.05, interval_s=0.02)
        self.assertFalse(v.passed)
        self.assertGreaterEqual(info, 1)
        self.assertLessEqual(len(calls), 4)
        v2 = Verifier()
        seq = iter([False, True])
        v2.assert_eventually("soon", lambda: (next(seq), None), timeout_s=1, interval_s=0.01)
        self.assertTrue(v2.passed)
        self.assertEqual(v2.checks[0]["tries"], 2)

    def test_finish_prints_one_json_line(self):
        v = Verifier()
        v.assert_equals("x", 1, 1)
        v.note(project="p")
        buf = io.StringIO()
        with redirect_stdout(buf), self.assertRaises(SystemExit) as e:
            v.finish()
        self.assertEqual(e.exception.code, 0)
        out = json.loads(buf.getvalue().strip())
        self.assertTrue(out["pass"])
        self.assertEqual(out["details"]["project"], "p")
        self.assertEqual(out["details"]["unexpected_mutations"], 0)


if __name__ == "__main__":
    unittest.main()
