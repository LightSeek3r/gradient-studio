"""Replays the shared golden vectors (``spec/vectors/v1-*.json``) against the port.

Non-boundary cases must match exactly; boundary-flagged cases must match on
measurements within tolerance (see ``tests/conformance.py`` for the policy).
The counts are printed after the run.
"""

from __future__ import annotations

import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

from . import conformance as c

_REPORTS: dict[str, c.FileReport] = {}


def tearDownModule() -> None:
    if _REPORTS:
        print("\n" + c.format_summary([_REPORTS[n] for n in c.VECTOR_FILES if n in _REPORTS]), file=sys.stderr)


class ConformanceTests(unittest.TestCase):
    def _run(self, name: str, *, cases: int, exact: int, boundary: int) -> None:
        report = c.CHECKS[name]()
        _REPORTS[name] = report
        shown = "\n".join(report.mismatches[:25])
        self.assertEqual(report.mismatches, [], f"{len(report.mismatches)} mismatches, first ones:\n{shown}")
        # The corpus is frozen: a changed count means the vectors changed (or cases went unchecked).
        self.assertEqual((report.cases, report.exact_checked, report.boundary), (cases, exact, boundary))

    def test_score_vectors(self) -> None:
        self._run("score", cases=316, exact=309, boundary=7)

    def test_findings_vectors(self) -> None:
        self._run("findings", cases=316, exact=275, boundary=41)
        self.assertEqual(_REPORTS["findings"].boundary_flag_mismatches, 0)

    def test_suggest_vectors(self) -> None:
        self._run("suggest", cases=316, exact=275, boundary=41)

    def test_interpolate_vectors(self) -> None:
        self._run("interpolate", cases=316, exact=316, boundary=0)

    def test_css_vectors(self) -> None:
        # 319 cases plus the spreadDirectionAngles table, counted as one case.
        self._run("css", cases=320, exact=320, boundary=0)

    def test_color_vectors(self) -> None:
        self._run("color", cases=156, exact=156, boundary=0)

    def test_boundary_cases_are_all_integer_exact_too(self) -> None:
        """Informational but pinned: every flagged case happens to match exactly as well
        (the flagged ones are integer gap thresholds hit exactly, not float ties)."""
        for name in ("score", "findings", "suggest"):
            report = _REPORTS.get(name) or c.CHECKS[name]()
            self.assertEqual(report.boundary_exact_anyway, report.boundary, name)

    def test_floats_agree_with_the_reference_to_tight_tolerance(self) -> None:
        for name in ("score", "findings", "color"):
            report = _REPORTS.get(name) or c.CHECKS[name]()
            with self.subTest(vectors=name):
                self.assertLess(report.floats.max_rel, 1e-11, report.floats.worst)
                self.assertLess(report.floats.max_abs, 1e-11)
                self.assertGreater(report.floats.bit_exact / report.floats.values, 0.9)


if __name__ == "__main__":
    unittest.main()


class HarnessSelfTests(unittest.TestCase):
    """The harness must fail when the port and the vectors disagree."""

    def _tampered_copy(self, tmp: str) -> Path:
        directory = Path(tmp)
        for name in c.VECTOR_FILES:
            data = c.load_vectors(name)
            if name == "score":
                case = next(x for x in data["cases"] if not x["boundary"] and x.get("status") != "unscorable")
                case["score"] += 1
            elif name == "css":
                data["cases"][0]["css"] += " "
            elif name == "findings":
                case = next(x for x in data["cases"] if x["boundary"])
                case["measurements"]["maxDeltaE"] += 1e-6  # boundary cases are still checked on measurements
            (directory / f"v1-{name}.json").write_text(json.dumps(data), encoding="utf-8")
        return directory

    def test_tampered_vectors_are_reported(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            directory = self._tampered_copy(tmp)
            reports = {r.name: r for r in c.run_all(directory)}
            self.assertEqual(len(reports["score"].mismatches), 1)
            self.assertEqual(len(reports["css"].mismatches), 1)
            self.assertEqual(len(reports["findings"].mismatches), 1)
            self.assertEqual(reports["interpolate"].mismatches, [])
            script = Path(__file__).resolve().parents[1] / "scripts" / "check_conformance.py"
            run = subprocess.run(
                [sys.executable, str(script), "--vectors", str(directory)], capture_output=True, text=True
            )
            self.assertEqual(run.returncode, 1, run.stdout)
            self.assertIn("MISMATCHES", run.stdout)

    def test_missing_vectors_directory_is_a_distinct_error(self) -> None:
        script = Path(__file__).resolve().parents[1] / "scripts" / "check_conformance.py"
        with tempfile.TemporaryDirectory() as tmp:
            run = subprocess.run([sys.executable, str(script), "--vectors", tmp], capture_output=True, text=True)
        self.assertEqual(run.returncode, 2)
