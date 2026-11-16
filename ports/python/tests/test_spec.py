"""The port's model table, finding codes and name table against the repository's own spec and reference."""

from __future__ import annotations

import re
import subprocess
import sys
import unittest
from dataclasses import fields, is_dataclass
from pathlib import Path
from typing import Any

from opal42_gradient import CSS_COLOR_NAMES, CSS_NAMED_COLORS, V1_FINDING_CODES, V1_MODEL, nearest_color_name

from .conformance import camel, find_vectors_dir

ROOT = Path(__file__).resolve().parents[1]
SPEC = find_vectors_dir().parents[0] / "scoring-v1.md"


def snake(name: str) -> str:
    return re.sub(r"([A-Z])", lambda m: "_" + m.group(1).lower(), name)


def lookup(path: str) -> Any:
    node: Any = V1_MODEL
    for part in path.split("."):
        node = getattr(node, snake(part))
    return node


class ModelMatchesSpecTests(unittest.TestCase):
    """Every ``V1_MODEL.<path> = <value>`` line of spec/scoring-v1.md, by the camelCase -> snake_case rule."""

    def test_every_documented_value(self) -> None:
        lines = re.findall(r"^- `V1_MODEL\.([\w.]+)` = (.+)$", SPEC.read_text(encoding="utf-8"), re.M)
        self.assertGreater(len(lines), 60)
        for path, text in lines:
            with self.subTest(path=path):
                expected = float(text) if "." in text else int(text)
                self.assertEqual(lookup(path), expected)

    def test_every_numeric_leaf_is_documented(self) -> None:
        """Nothing in the port's table is missing from the spec (messages and codes are checked by the vectors)."""
        documented = {
            path for path, _ in re.findall(r"^- `V1_MODEL\.([\w.]+)` = (.+)$", SPEC.read_text(encoding="utf-8"), re.M)
        }

        def leaves(node: Any, prefix: str) -> list[str]:
            out: list[str] = []
            for f in fields(node):
                value = getattr(node, f.name)
                path = f"{prefix}.{camel(f.name)}" if prefix else camel(f.name)
                if is_dataclass(value):
                    out += leaves(value, path)
                elif isinstance(value, (int, float)) and not isinstance(value, bool):
                    out.append(path)
            return out

        undocumented = [p for p in leaves(V1_MODEL, "") if p not in documented]
        self.assertEqual(sorted(undocumented), [])

    def test_every_finding_code_has_a_section(self) -> None:
        text = SPEC.read_text(encoding="utf-8")
        sections = set(re.findall(r"^### `([a-z]+/[a-z-]+)`", text, re.M))
        self.assertEqual(sections, set(V1_FINDING_CODES))

    def test_severity_follows_the_penalty(self) -> None:
        """Spec section 2: >= 12 error, 6-10 warning, <= 5 info."""

        def tiers(node: Any) -> list[Any]:
            out = []
            for f in fields(node):
                value = getattr(node, f.name)
                if is_dataclass(value):
                    out += [value] if f.name != "tier" and hasattr(value, "severity") and hasattr(value, "penalty") else []
                    out += tiers(value)
            return out

        checked = 0
        for tier in tiers(V1_MODEL):
            expected = "error" if tier.penalty >= 12 else "warning" if tier.penalty >= 6 else "info"
            self.assertEqual(tier.severity, expected, tier.message)
            checked += 1
        self.assertGreater(checked, 20)

    def test_weights_sum_to_100(self) -> None:
        w = V1_MODEL.weights
        self.assertEqual(w.lightness + w.hue + w.chroma + w.rhythm, 100)

    def test_model_is_immutable(self) -> None:
        with self.assertRaises(Exception):
            V1_MODEL.weights.hue = 31  # type: ignore[misc]
        with self.assertRaises(TypeError):
            CSS_NAMED_COLORS["red"] = "#000000"  # type: ignore[index]


class NameTableTests(unittest.TestCase):
    def test_148_names(self) -> None:
        self.assertEqual(len(CSS_NAMED_COLORS), 148)
        self.assertEqual(len(CSS_COLOR_NAMES), 148)
        self.assertTrue(all(re.fullmatch(r"#[0-9a-f]{6}", h) for h in CSS_NAMED_COLORS.values()))

    def test_aliases_resolve_to_the_first_spelling(self) -> None:
        self.assertEqual(nearest_color_name("#00ffff").name, "aqua")
        self.assertEqual(nearest_color_name("#808080").name, "gray")
        self.assertEqual(nearest_color_name("#ff00ff").name, "fuchsia")

    def test_generated_table_is_in_sync_with_the_typescript_source(self) -> None:
        source = ROOT.parents[1] / "packages" / "core" / "src" / "color-formats.ts"
        if not source.is_file():
            self.skipTest("TypeScript reference not present (port checked out on its own)")
        result = subprocess.run(
            [sys.executable, str(ROOT / "scripts" / "gen_names.py"), "--check"], capture_output=True, text=True
        )
        self.assertEqual(result.returncode, 0, result.stderr)


if __name__ == "__main__":
    unittest.main()
