#!/usr/bin/env python3
"""Replay spec/vectors/v1-*.json against the Python port and print a summary.

    python3 scripts/check_conformance.py [--vectors DIR] [--show N]

Exit status 0 when there is no mismatch, 1 otherwise (2 if the vectors cannot
be found).  Policy (PLAN section 3.3): non-boundary cases must match exactly,
boundary cases on measurements within tolerance only; the counts of both are
printed, together with how close the floating-point measurements are.
"""

from __future__ import annotations

import argparse
import platform
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))
sys.path.insert(0, str(ROOT))

from tests import conformance  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--vectors", type=Path, help="directory holding v1-*.json (default: the repository's spec/vectors)")
    parser.add_argument("--show", type=int, default=20, metavar="N", help="print at most N mismatches (default 20)")
    args = parser.parse_args()

    try:
        directory = args.vectors or conformance.find_vectors_dir()
        reports = conformance.run_all(directory)
    except FileNotFoundError as error:
        print(error, file=sys.stderr)
        return 2

    print(f"opal42-gradient conformance: Python {platform.python_version()} on {platform.system()} ({platform.machine()})")
    print(f"vectors: {directory}")
    print(conformance.format_summary(reports))

    mismatches = [m for r in reports for m in r.mismatches]
    flag_mismatches = sum(r.boundary_flag_mismatches for r in reports)
    if flag_mismatches:
        print(f"\n{flag_mismatches} case(s) where the port's own boundary_hits() disagrees with the vector flag")
    if mismatches:
        print(f"\n{len(mismatches)} MISMATCHES:")
        for line in mismatches[: args.show]:
            print("  " + line)
        if len(mismatches) > args.show:
            print(f"  ... and {len(mismatches) - args.show} more")
        return 1
    cases = sum(r.cases for r in reports)
    exact = sum(r.exact_checked for r in reports)
    boundary = sum(r.boundary for r in reports)
    print(f"\nOK: {cases} cases ({exact} compared exactly, {boundary} boundary), 0 mismatches")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
