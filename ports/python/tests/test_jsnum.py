"""The JavaScript-semantics helpers (``_jsnum``)."""

from __future__ import annotations

import math
import unittest

from opal42_gradient._jsnum import js_cbrt, js_fmod, js_number_str, js_parse_float, js_round, js_trim


class JsRoundTests(unittest.TestCase):
    def test_halves_go_towards_positive_infinity(self) -> None:
        # (input, Math.round(input)); Python's round() gives 0, 2, 2, 4, -0, -2, -2 for these.
        for value, expected in [
            (0.5, 1), (1.5, 2), (2.5, 3), (3.5, 4), (-0.5, 0), (-1.5, -1), (-2.5, -2), (127.5, 128), (254.5, 255),
        ]:
            with self.subTest(value=value):
                self.assertEqual(js_round(value), expected)

    def test_banker_rounding_is_really_different(self) -> None:
        self.assertNotEqual(round(2.5), js_round(2.5))
        self.assertNotEqual(round(0.5), js_round(0.5))

    def test_not_floor_of_x_plus_half(self) -> None:
        tricky = 0.49999999999999994  # x + 0.5 == 1.0 in floating point, but Math.round(x) is 0
        self.assertEqual(math.floor(tricky + 0.5), 1)
        self.assertEqual(js_round(tricky), 0)
        self.assertEqual(js_round(4503599627370497.0), 4503599627370497)  # 2**52 + 1: already an integer

    def test_ordinary_values_and_types(self) -> None:
        for value, expected in [(0.4, 0), (0.6, 1), (-0.4, 0), (-0.6, -1), (255.0, 255), (7, 7)]:
            with self.subTest(value=value):
                result = js_round(value)
                self.assertEqual(result, expected)
                self.assertIsInstance(result, int)

    def test_non_finite_is_returned_unchanged(self) -> None:
        self.assertTrue(math.isnan(js_round(math.nan)))
        self.assertEqual(js_round(math.inf), math.inf)


class JsFmodTests(unittest.TestCase):
    def test_sign_follows_the_dividend(self) -> None:
        self.assertEqual(js_fmod(-30, 360), -30)  # JS: -30 % 360 === -30
        self.assertEqual(-30 % 360, 330)  # Python's floored modulo differs
        self.assertEqual(js_fmod(js_fmod(-30, 360) + 360, 360), 330)
        self.assertEqual(js_fmod(725.5, 360), 5.5)


class JsCbrtTests(unittest.TestCase):
    def test_special_values(self) -> None:
        self.assertEqual(js_cbrt(0.0), 0.0)
        self.assertEqual(js_cbrt(1.0), 1.0)
        self.assertEqual(js_cbrt(8.0), 2.0)
        self.assertEqual(js_cbrt(-27.0), -3.0)
        self.assertEqual(js_cbrt(math.inf), math.inf)
        self.assertTrue(math.isnan(js_cbrt(math.nan)))
        self.assertTrue(math.copysign(1, js_cbrt(-0.0)) < 0)

    def test_subnormal_and_extreme(self) -> None:
        self.assertAlmostEqual(js_cbrt(5e-324) / 1.7e-108, 1.0, delta=0.05)
        self.assertAlmostEqual(js_cbrt(1e300) / 1e100, 1.0, places=14)

    def test_close_to_the_platform_cbrt(self) -> None:
        cbrt = getattr(math, "cbrt", None)  # Python >= 3.11
        if cbrt is None:
            self.skipTest("math.cbrt needs Python 3.11")
        for i in range(1, 2000):
            x = i / 997.0
            self.assertAlmostEqual(js_cbrt(x) / cbrt(x), 1.0, delta=1e-15)

    def test_cube_round_trip(self) -> None:
        for i in range(1, 500):
            x = i * 0.0021
            self.assertAlmostEqual(js_cbrt(x) ** 3 / x, 1.0, delta=1e-15)


class JsNumberStrTests(unittest.TestCase):
    def test_cases(self) -> None:
        for value, expected in [
            (1, "1"), (1.0, "1"), (0.0, "0"), (-0.0, "0"), (100.0, "100"), (0.5, "0.5"), (-30, "-30"),
            (33.333333333333336, "33.333333333333336"), (0.001, "0.001"), (1e-7, "1e-7"), (1.5e-7, "1.5e-7"),
            (123456789012345680000.0, "123456789012345680000"), (1e21, "1e+21"), (1.5e300, "1.5e+300"),
            (0.000001, "0.000001"), (5e-324, "5e-324"), (1e16, "10000000000000000"), (-0.25, "-0.25"),
            (math.inf, "Infinity"), (-math.inf, "-Infinity"), (math.nan, "NaN"), (0.1 + 0.2, "0.30000000000000004"),
        ]:
            with self.subTest(value=value):
                self.assertEqual(js_number_str(value), expected)

    def test_bool_is_not_a_number(self) -> None:
        with self.assertRaises(TypeError):
            js_number_str(True)


class JsStringTests(unittest.TestCase):
    def test_trim_uses_the_ecmascript_whitespace_set(self) -> None:
        self.assertEqual(js_trim("﻿  abc  \n"), "abc")
        self.assertEqual("\x1cabc".strip(), "abc")  # Python strips U+001C, JavaScript does not
        self.assertEqual(js_trim("\x1cabc"), "\x1cabc")

    def test_parse_float(self) -> None:
        for text, expected in [
            ("12", 12.0), ("-.5", -0.5), ("1.5 %", 1.5), ("  7px", 7.0), ("1e3x", 1000.0), ("+2.", 2.0), ("0x10", 0.0),
        ]:
            with self.subTest(text=text):
                self.assertEqual(js_parse_float(text), expected)
        self.assertTrue(math.isnan(js_parse_float("abc")))
        self.assertTrue(math.isnan(js_parse_float("")))


if __name__ == "__main__":
    unittest.main()
