"""Property tests over seeded random inputs (no extra dependencies, fully reproducible)."""

from __future__ import annotations

import math
import random
import re
import string
import unittest

from opal42_gradient import (
    Lch,
    Stop,
    V1_MODEL,
    build_gradient_css,
    color_at_position,
    complement_hex,
    hex_to_oklch,
    interpolate_gradient,
    lch_to_oklab,
    oklch_to_hex,
    parse_any_color,
    refine_gradient,
    score_gradient,
    suggest_gradient,
)

HEX = re.compile(r"#[0-9a-f]{6}")
DIMENSIONS = {"lightness": "lightness", "hue": "hue", "chroma": "chroma", "rhythm": "spacing"}


def random_hex(rng: random.Random) -> str:
    kind = rng.random()
    if kind < 0.15:  # greys and near-greys exercise the achromatic paths
        v = rng.randrange(256)
        return f"#{v:02x}{min(255, v + rng.randrange(3)):02x}{v:02x}"
    return f"#{rng.randrange(1 << 24):06x}"


def random_stops(rng: random.Random, *, unique: bool = False) -> list[Stop]:
    n = rng.randint(2, 8)
    if unique:
        positions: list[float] = sorted(rng.sample(range(0, 101), n))
    else:
        mode = rng.random()
        if mode < 0.4:
            positions = [rng.randint(0, 100) for _ in range(n)]
        elif mode < 0.7:
            positions = [round(rng.uniform(0, 100), 2) for _ in range(n)]
        else:  # hard stops: pairs of neighbours at the same / adjacent position
            base = sorted(rng.randint(0, 100) for _ in range(n))
            positions = [p if rng.random() < 0.6 else min(100, p + rng.randint(0, 1)) for p in base]
    return [Stop(random_hex(rng), p, i + 1) for i, p in enumerate(positions)]


def all_floats(measurements: object) -> list[float]:
    out: list[float] = []
    for name in measurements.__dataclass_fields__:  # type: ignore[attr-defined]
        value = getattr(measurements, name)
        for v in value if isinstance(value, tuple) else [value]:
            if v is not None:
                out.append(float(v))
    return out


class ScoreProperties(unittest.TestCase):
    N = 1500

    def test_score_is_an_int_in_range_with_finite_measurements(self) -> None:
        rng = random.Random(20260101)
        for _ in range(self.N):
            stops = random_stops(rng)
            result = score_gradient(stops)
            self.assertEqual(result.status, "ok", stops)
            self.assertIs(type(result.score), int)
            self.assertTrue(0 <= result.score <= 100, (result.score, stops))
            assert result.details.measurements is not None
            self.assertTrue(all(math.isfinite(v) for v in all_floats(result.details.measurements)), stops)
            self.assertEqual(result.score, sum(getattr(result.details, d) for d in DIMENSIONS.values()))

    def test_every_lost_point_is_explained_by_a_finding(self) -> None:
        rng = random.Random(7)
        for _ in range(self.N):
            result = score_gradient(random_stops(rng))
            self.assertEqual(result.issues, tuple(f.message for f in result.findings))
            lost_total = 0
            for dimension, weight in (
                ("lightness", V1_MODEL.weights.lightness),
                ("hue", V1_MODEL.weights.hue),
                ("chroma", V1_MODEL.weights.chroma),
                ("rhythm", V1_MODEL.weights.rhythm),
            ):
                lost = sum(f.points_lost for f in result.findings if f.dimension == dimension)
                got = getattr(result.details, DIMENSIONS[dimension])
                self.assertEqual(weight - got, min(weight, lost), (dimension, result))
                lost_total += min(weight, lost)
            self.assertEqual(100 - result.score, lost_total)
            for f in result.findings:  # locations are indices into the sorted stops
                n = len(result.details.measurements.segment_gaps) + 1  # type: ignore[union-attr]
                self.assertTrue(all(0 <= i < n for i in f.stops or ()))

    def test_permutation_invariance(self) -> None:
        rng = random.Random(99)
        for _ in range(500):
            stops = random_stops(rng, unique=True)
            shuffled = stops[:]
            rng.shuffle(shuffled)
            a, b = score_gradient(stops), score_gradient(shuffled)
            self.assertEqual(a, b, (stops, shuffled))
            self.assertEqual(suggest_gradient(stops), suggest_gradient(shuffled))

    def test_ties_keep_input_order_but_nothing_else_matters(self) -> None:
        stops = [Stop("#ff0000", 0), Stop("#00ff00", 50), Stop("#0000ff", 50), Stop("#ffffff", 100)]
        swapped = [stops[3], stops[1], stops[0], stops[2]]  # keeps 00ff00 before 0000ff
        self.assertEqual(score_gradient(stops), score_gradient(swapped))

    def test_dict_tuple_and_stop_inputs_agree(self) -> None:
        as_stops = [Stop("#112233", 0, 1), Stop("#aabbcc", 100, 2)]
        as_dicts = [{"color": "#112233", "position": 0, "id": 1}, {"color": "#aabbcc", "position": 100, "id": 2}]
        as_tuples = [("#112233", 0), ("#aabbcc", 100)]
        self.assertEqual(score_gradient(as_stops), score_gradient(as_dicts))
        self.assertEqual(score_gradient(as_stops), score_gradient(as_tuples))


class RefineProperties(unittest.TestCase):
    def test_refine_never_lowers_the_score(self) -> None:
        rng = random.Random(31337)
        refined_count = 0
        for _ in range(1200):
            stops = random_stops(rng)
            result = refine_gradient(stops)
            before = score_gradient(stops).score
            self.assertEqual(result.before, before)
            self.assertGreaterEqual(result.after, result.before, stops)
            self.assertEqual(score_gradient(result.stops).score, result.after)
            self.assertGreaterEqual(score_gradient(suggest_gradient(stops)).score, before)
            refined_count += result.refined
        self.assertGreater(refined_count, 300)  # the property is not vacuous

    def test_refine_keeps_hard_stops_and_achromatic_stops(self) -> None:
        rng = random.Random(4242)
        checked = 0
        for _ in range(1200):
            stops = random_stops(rng)
            result = refine_gradient(stops)
            by_pos = sorted(stops, key=lambda s: s.position)
            if not result.refined:
                self.assertEqual([(s.color, s.position, s.id) for s in result.stops],
                                 [(s.color, s.position, s.id) for s in by_pos])
                continue
            checked += 1
            self.assertEqual([s.id for s in result.stops], [s.id for s in by_pos])
            for i, (old, new) in enumerate(zip(by_pos, result.stops)):
                self.assertTrue(HEX.fullmatch(new.color), new)
                self.assertTrue(math.isfinite(new.position))
                if hex_to_oklch(old.color).C <= V1_MODEL.refine.achromatic_at_most:
                    self.assertLessEqual(hex_to_oklch(new.color).C, V1_MODEL.refine.achromatic_at_most, (old, new))
                if i > 0:  # hard stops stay hard; no stop jumps backwards
                    gap_before = old.position - by_pos[i - 1].position
                    gap_after = new.position - result.stops[i - 1].position
                    self.assertGreaterEqual(gap_after, 0)
                    if gap_before <= V1_MODEL.refine.hard_stop_gap:
                        self.assertAlmostEqual(gap_after, gap_before, delta=1e-9)
        self.assertGreater(checked, 300)

    def test_refine_is_idempotent_enough_to_stay_in_domain(self) -> None:
        rng = random.Random(5)
        for _ in range(300):
            once = suggest_gradient(random_stops(rng))
            twice = suggest_gradient(once)
            self.assertGreaterEqual(score_gradient(twice).score, score_gradient(once).score)

    def test_declines_are_reported(self) -> None:
        self.assertEqual(refine_gradient([Stop("#ff0000", 40), Stop("#0000ff", 40.5)]).declined, "single-position")
        self.assertEqual(refine_gradient([Stop("red", 0), Stop("#0000ff", 100)]).declined, "unscorable")
        # Input that already scores 100 can only decline or stay at 100.
        smooth = [Stop("#ff006c", 0), Stop("#5c00e7", 100)]
        self.assertEqual(score_gradient(smooth).score, 100)
        self.assertEqual(refine_gradient(smooth).after, 100)


class OtherProperties(unittest.TestCase):
    def test_interpolation(self) -> None:
        rng = random.Random(11)
        for _ in range(400):
            stops = random_stops(rng)
            n = rng.randint(2, 20)
            colors = interpolate_gradient(stops, n)
            self.assertEqual(len(colors), n)
            self.assertTrue(all(HEX.fullmatch(c) for c in colors), colors)
            ordered = sorted(stops, key=lambda s: s.position)
            self.assertEqual(color_at_position(stops, -5), ordered[0].color)
            self.assertEqual(color_at_position(stops, 105), ordered[-1].color)

    def test_css_contains_every_stop(self) -> None:
        rng = random.Random(12)
        for _ in range(300):
            stops = random_stops(rng)
            css = build_gradient_css(stops, rng.choice([0, 45, 90, 135.5, 360]))
            self.assertTrue(css.startswith("linear-gradient(") and css.endswith("%)"), css)
            self.assertEqual(css.count("#"), len(stops))
            self.assertNotIn("NaN", css)

    def test_hex_round_trip_through_oklch(self) -> None:
        rng = random.Random(13)
        for _ in range(3000):
            h = f"#{rng.randrange(1 << 24):06x}"
            self.assertEqual(oklch_to_hex(hex_to_oklch(h)), h)

    def test_hue_rotation_by_360_is_invisible(self) -> None:
        rng = random.Random(14)
        for _ in range(500):
            lch = Lch(rng.random(), rng.random() * 0.4, rng.uniform(-720, 720))
            a, b = lch_to_oklab(lch), lch_to_oklab(Lch(lch.L, lch.C, lch.h + 360))
            self.assertAlmostEqual(a.a, b.a, delta=1e-12)
            self.assertAlmostEqual(a.b, b.b, delta=1e-12)

    def test_complement_is_a_hex_and_mostly_an_involution(self) -> None:
        rng = random.Random(15)
        close = 0
        for _ in range(500):
            h = f"#{rng.randrange(1 << 24):06x}"
            c = complement_hex(h)
            self.assertTrue(HEX.fullmatch(c), c)
            close += complement_hex(c) == h
        self.assertGreater(close, 40)  # gamut mapping makes it only approximately an involution

    def test_garbage_never_raises(self) -> None:
        rng = random.Random(16)
        weird: list[object] = [
            None, 0, 1.5, "x", "#ff0000", b"ab", [], {}, [None], [None, None], [("#ff0000", 0), None], True,
            [{"color": "#ff0000"}, {"position": 3}], [("#ff0000", math.nan), ("#00ff00", 1)],
            [("#ff0000", math.inf), ("#00ff00", 1)], [("#ff0000", True), ("#00ff00", 1)],
            [("#ff0000\n", 0), ("#00ff00", 100)], [("#ff0000", "0"), ("#00ff00", 100)], [Stop("#ff0000", 0)],
        ]
        for item in weird:
            result = score_gradient(item)  # type: ignore[arg-type]
            self.assertEqual(result.status, "unscorable")
            self.assertEqual((result.score, result.issues, result.findings), (0, (), ()))
            self.assertIsInstance(result.reason, str)
        alphabet = string.printable + "é ﻿٠"
        for _ in range(3000):
            text = "".join(rng.choice(alphabet) for _ in range(rng.randint(0, 30)))
            parsed = parse_any_color(text)
            self.assertTrue(parsed is None or HEX.fullmatch(parsed), (text, parsed))

    def test_inputs_are_not_mutated(self) -> None:
        stops = [{"color": "#ff0000", "position": 70, "id": 1}, {"color": "#0000ff", "position": 10, "id": 2}]
        snapshot = [dict(s) for s in stops]
        score_gradient(stops)
        suggest_gradient(stops)
        build_gradient_css(stops, 90)
        self.assertEqual(stops, snapshot)


if __name__ == "__main__":
    unittest.main()
