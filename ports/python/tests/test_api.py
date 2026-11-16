"""Public API behaviour that the vectors do not spell out."""

from __future__ import annotations

import dataclasses
import unittest
from pathlib import Path

import opal42_gradient as og
from opal42_gradient import (
    GradientDirection,
    Stop,
    build_gradient_css,
    build_multi_gradient_style,
    format_hex,
    parse_any_color,
    score_gradient,
    spread_direction_angles,
    unscorable_reason,
)


class ApiTests(unittest.TestCase):
    def test_all_exports_exist(self) -> None:
        for name in og.__all__:
            self.assertTrue(hasattr(og, name), name)
        self.assertEqual(len(og.__all__), len(set(og.__all__)))

    def test_package_is_typed_and_has_no_runtime_dependencies(self) -> None:
        package = Path(og.__file__).parent
        self.assertTrue((package / "py.typed").is_file())
        import ast

        stdlib = set(__import__("sys").stdlib_module_names) if hasattr(__import__("sys"), "stdlib_module_names") else None
        for path in package.glob("*.py"):
            for node in ast.walk(ast.parse(path.read_text(encoding="utf-8"))):
                if isinstance(node, ast.Import):
                    roots = [a.name.split(".")[0] for a in node.names]
                elif isinstance(node, ast.ImportFrom) and node.level == 0:
                    roots = [(node.module or "").split(".")[0]]
                else:
                    continue
                for root in roots:
                    if stdlib is not None:  # Python >= 3.10 has sys.stdlib_module_names
                        self.assertIn(root, stdlib, f"{path.name} imports non-stdlib module {root!r}")

    def test_results_are_immutable(self) -> None:
        result = score_gradient([Stop("#ff0000", 0), Stop("#0000ff", 100)])
        with self.assertRaises(dataclasses.FrozenInstanceError):
            result.score = 100  # type: ignore[misc]
        with self.assertRaises(dataclasses.FrozenInstanceError):
            Stop("#000000", 0).position = 1  # type: ignore[misc]

    def test_unscorable_reasons_match_the_reference_wording(self) -> None:
        cases = [
            ([], "needs at least 2 stops"),
            ([("#ff0000", 0)], "needs at least 2 stops"),
            ([("#ff0000", 0), ("#0000ff", 150)], "stop 1: position 150 is outside 0..100"),
            ([("#ff0000", -0.5), ("#0000ff", 100)], "stop 0: position -0.5 is outside 0..100"),
            ([("#ff0000", 0), ("red", 100)], 'stop 1: colour "red" is not an opaque #rrggbb hex colour'),
            ([("#ff0000", 0), ("#00ff00", float("nan"))], "stop 1: position is not a finite number"),
            ([("#ff0000\n", 0), ("#00ff00", 1)], 'stop 0: colour "#ff0000\\n" is not an opaque #rrggbb hex colour'),
        ]
        for stops, reason in cases:
            with self.subTest(stops=stops):
                self.assertEqual(unscorable_reason(stops), reason)
                self.assertEqual(score_gradient(stops).reason, reason)

    def test_upper_case_hex_is_accepted(self) -> None:
        self.assertEqual(score_gradient([("#FF0000", 0), ("#0000FF", 100)]).status, "ok")

    def test_css_formats_numbers_like_javascript(self) -> None:
        self.assertEqual(
            build_gradient_css([("#ff0000", 0), ("#0000ff", 33.5), ("#ffffff", 100.0)], 90.0),
            "linear-gradient(90deg, #ff0000 0%, #0000ff 33.5%, #ffffff 100%)",
        )
        self.assertEqual(build_gradient_css([("zzz", 0)], 0), "#ccc")
        self.assertEqual(build_gradient_css([("#ff0000", float("nan"))], 0), "#ccc")

    def test_multi_gradient(self) -> None:
        style = build_multi_gradient_style(
            [("#ff0000", 0), ("#0000ff", 100)],
            [GradientDirection(1, 0, 50, True), GradientDirection(2, 90, 50, True), GradientDirection(3, 180, 0, True)],
            "multiply",
        )
        self.assertEqual(style.background_blend_mode, "multiply, normal")
        self.assertEqual(style.background.count("linear-gradient("), 2)
        self.assertTrue(style.background.startswith("linear-gradient(90deg, rgba(255, 0, 0, 1) 0%"))

    def test_spread_direction_angles(self) -> None:
        self.assertEqual(spread_direction_angles(3), [135, 255, 15])
        self.assertEqual(spread_direction_angles(99), spread_direction_angles(7))
        self.assertEqual(spread_direction_angles(0), [135])

    def test_formats(self) -> None:
        self.assertEqual(format_hex("#ff6347"), "#FF6347")
        self.assertEqual(parse_any_color("Dark Blue"), "#00008b")
        self.assertIsNone(parse_any_color("linear-gradient(red, blue)"))
        self.assertEqual(parse_any_color("﻿ #FFF  "), "#ffffff")  # JavaScript trim() semantics
        self.assertIsNone(parse_any_color("#fff\n#000"))


if __name__ == "__main__":
    unittest.main()
