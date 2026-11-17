"""D8: tolerance-aware selection (``_tolerance.py``, docs/DETERMINISM.md)."""

from __future__ import annotations

import math
import random
import unittest
from unittest import mock

from opal42_gradient import Stop, score_gradient
from opal42_gradient import _jsnum, colorspace
from opal42_gradient._tolerance import EPS, approx_eq, arg_best, hue_arc_ends


def _stops(pairs: list[tuple[str, float]]) -> list[Stop]:
    return [Stop(c, p, i + 1) for i, (c, p) in enumerate(pairs)]


def _locations(pairs: list[tuple[str, float]]) -> list[tuple[str, object, object]]:
    return [(f.code, f.stops, f.segment) for f in score_gradient(_stops(pairs)).findings]


class ToleranceHelpers(unittest.TestCase):
    def test_constants_and_approx_eq(self) -> None:
        self.assertEqual(EPS, 1e-9)
        self.assertTrue(approx_eq(142.49533888781002, 142.4953388878099))
        self.assertFalse(approx_eq(1, 1 + 2e-9))
        self.assertFalse(approx_eq(math.nan, math.nan))

    def test_arg_best_breaks_ties_by_lowest_index(self) -> None:
        self.assertEqual(arg_best([0.5, 0.5 + 1e-15, 0.1], "max"), 0)
        self.assertEqual(arg_best([0.5 + 1e-15, 0.5, 0.1], "max"), 0)
        self.assertEqual(arg_best([0.5, 0.5 + 1e-6], "max"), 1)
        self.assertEqual(arg_best([math.nan, 2.0], "min"), 1)
        self.assertEqual(arg_best([], "min"), -1)

    def test_hue_arc_ends_matches_the_reference_rule(self) -> None:
        def ends(hs: list[float]) -> list[int]:
            order = sorted(range(len(hs)), key=lambda i: (hs[i], i))
            return hue_arc_ends(order, hs)

        self.assertEqual(ends([142.5, 142.5 + 1e-13, 142.5 - 1e-13]), [0, 2])
        self.assertEqual(ends([110, 10, 110 - 1e-13, 10 + 1e-13]), [1, 2])
        self.assertEqual(ends([359.9999999999999, 0.0000000000001, 90]), [0, 2])
        self.assertEqual(ends([0, 120, 240]), [0, 2])
        self.assertEqual(ends([10, 50, 30]), [0, 1])

    def test_perturbations_at_1e_12_do_not_move_a_selection(self) -> None:
        rng = random.Random(0xD8)
        palette = [0.0, 0.5, 40.0, 142.49533888781, 200.0, 359.9999999999995]
        for _ in range(500):
            hs = [rng.choice(palette) for _ in range(rng.randint(2, 7))]
            order = sorted(range(len(hs)), key=lambda i: (hs[i], i))
            want = hue_arc_ends(order, hs)
            jittered = [math.fmod(math.fmod(h + rng.uniform(-1e-12, 1e-12), 360) + 360, 360) for h in hs]
            order2 = sorted(range(len(jittered)), key=lambda i: (jittered[i], i))
            self.assertEqual(hue_arc_ends(order2, jittered), want)


class EngineLocations(unittest.TestCase):
    REPRO = [("#00a600", 0.0), ("#00ff00", 50.0), ("#006900", 100.0)]
    THREE = [("#ff0000", 0.0), ("#0000ff", 11.0), ("#00ff00", 100.0)]

    def test_same_hue_family_names_lowest_and_highest_index(self) -> None:
        self.assertIn(("hue/narrow-arc", (0, 2), None), _locations(self.REPRO))

    def test_three_stop_velocity_tie_names_the_first_segment(self) -> None:
        self.assertIn(("lightness/uneven-speed", (0, 1), (0.0, 11.0)), _locations(self.THREE))

    def test_platform_cbrt_no_longer_moves_a_location(self) -> None:
        # docs/python.md: with the platform cube root instead of the V8 algorithm, five
        # vector cases used to report another location. With D8 the noise is absorbed.
        cases = [self.REPRO, self.THREE, [("#ff0000", 0.0), ("#0000ff", 10.0), ("#00ff00", 100.0)]]
        want = [_locations(c) for c in cases]
        if not hasattr(math, "cbrt"):
            self.skipTest("math.cbrt needs Python 3.11")
        with mock.patch.object(colorspace, "js_cbrt", math.cbrt):
            self.assertEqual([_locations(c) for c in cases], want)
        self.assertTrue(callable(_jsnum.js_cbrt))


if __name__ == "__main__":
    unittest.main()
