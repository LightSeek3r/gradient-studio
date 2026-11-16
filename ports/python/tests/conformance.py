"""Replays ``spec/vectors/v1-*.json`` against the port and counts the results.

Used by ``tests/test_conformance.py`` (unittest) and
``scripts/check_conformance.py`` (command line).  Policy (PLAN section 3.3):

* **Non-boundary cases** must match *exactly*: scores, details, finding codes /
  severities / locations / messages, hex and CSS strings, integer channels.
  Floating-point measurements must agree within ``REL_TOL`` / ``ABS_TOL``.
* **Boundary cases** (``boundary: true`` in the vector, i.e. some measurement is
  within 1e-6 of a threshold) are only required to match on measurements within
  tolerance.  Whether the integer outputs happened to match anyway is counted
  and reported, not required.

``suggest`` vectors carry no flag of their own; a suggest case counts as a
boundary case when the same-named case of ``v1-findings.json`` is flagged.
``interpolate`` and ``css`` vectors have no thresholds and are always exact.
"""

from __future__ import annotations

import json
import math
import os
import re
import struct
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from opal42_gradient import (
    HSL,
    RGB,
    GradientDirection,
    Lch,
    Oklab,
    ScoreMeasurements,
    boundary_hits,
    build_gradient_css,
    build_multi_gradient_style,
    color_at_position,
    complement_hex,
    format_hex,
    format_hsl,
    format_name,
    format_name_display,
    format_rgb,
    gamut_fit_oklch,
    hex_to_hsl,
    hex_to_hsl_precise,
    hex_to_oklch,
    hex_to_rgb,
    hsl_to_hex,
    hsl_to_rgb,
    interpolate_gradient,
    lch_to_oklab,
    linear_to_srgb,
    nearest_color_name,
    oklab_to_linear_rgb,
    oklab_to_rgb,
    oklch_to_hex,
    oklch_to_hex_fitted,
    parse_any_color,
    parse_hex,
    parse_hsl,
    parse_name,
    parse_rgb,
    rgb_to_hex,
    rgb_to_oklab,
    score_gradient,
    spread_direction_angles,
    srgb_to_linear,
    suggest_gradient,
)

#: Floating-point measurements must agree to this relative / absolute tolerance.
REL_TOL = 1e-9
ABS_TOL = 1e-12

VECTOR_FILES = ("score", "findings", "suggest", "interpolate", "css", "color")


def find_vectors_dir() -> Path:
    override = os.environ.get("OPAL42_VECTORS_DIR")
    if override:
        return Path(override)
    here = Path(__file__).resolve()
    for parent in here.parents:
        candidate = parent / "spec" / "vectors"
        if (candidate / "v1-score.json").is_file():
            return candidate
    raise FileNotFoundError(
        "spec/vectors/ not found above tests/; run from a checkout of the repository "
        "or set OPAL42_VECTORS_DIR"
    )


def load_vectors(name: str, directory: Path | None = None) -> dict[str, Any]:
    path = (directory or find_vectors_dir()) / f"v1-{name}.json"
    with path.open(encoding="utf-8") as handle:
        return json.load(handle)


# ── Report ───────────────────────────────────────────────────────────────────


@dataclass
class FloatStats:
    """How far the port's floating-point numbers are from the reference's.

    ``max_rel`` is the largest relative error among values whose magnitude is at
    least ``1e-6`` (smaller values are noise such as the ``a``/``b`` of a grey);
    ``max_abs`` is the largest absolute error of any value.
    """

    values: int = 0
    bit_exact: int = 0
    max_rel: float = 0.0
    max_abs: float = 0.0
    worst: str = ""

    def record(self, where: str, expected: float, actual: float) -> None:
        self.values += 1
        if expected == actual or struct.pack(">d", expected) == struct.pack(">d", actual):
            self.bit_exact += 1
            return
        err = abs(expected - actual)
        self.max_abs = max(self.max_abs, err)
        scale = max(abs(expected), abs(actual))
        if scale >= 1e-6 and err / scale > self.max_rel:
            self.max_rel = err / scale
            self.worst = where


@dataclass
class FileReport:
    name: str
    cases: int = 0
    exact_checked: int = 0  # non-boundary cases compared exactly
    boundary: int = 0  # boundary-flagged cases (measurements only required)
    boundary_exact_anyway: int = 0  # ... of which the integer outputs matched too
    mismatches: list[str] = field(default_factory=list)
    floats: FloatStats = field(default_factory=FloatStats)
    boundary_flag_mismatches: int = 0  # port's own boundary_hits() disagrees with the vector flag

    def fail(self, case: str, message: str) -> None:
        self.mismatches.append(f"{self.name}: {case}: {message}")


# ── Comparison primitives ────────────────────────────────────────────────────


def _close(expected: float, actual: float) -> bool:
    return math.isclose(expected, actual, rel_tol=REL_TOL, abs_tol=ABS_TOL)


class Differ:
    """Collects differences between a vector value and the port's value."""

    def __init__(self, report: FileReport) -> None:
        self.report = report
        self.diffs: list[str] = []

    def exact(self, path: str, expected: Any, actual: Any) -> None:
        if expected != actual or type(expected) is bool != (type(actual) is bool):
            self.diffs.append(f"{path}: expected {expected!r}, got {actual!r}")

    def number(self, path: str, expected: float | None, actual: float | None) -> None:
        """A floating-point measurement: within tolerance, ``None`` only for ``None``."""
        if expected is None or actual is None:
            if expected is not actual:
                self.diffs.append(f"{path}: expected {expected!r}, got {actual!r}")
            return
        self.report.floats.record(path, float(expected), float(actual))
        if not _close(float(expected), float(actual)):
            self.diffs.append(f"{path}: expected {expected!r}, got {actual!r}")

    def numbers(self, path: str, expected: list[float], actual: Any) -> None:
        if len(expected) != len(actual):
            self.diffs.append(f"{path}: expected {len(expected)} values, got {len(actual)}")
            return
        for i, (e, a) in enumerate(zip(expected, actual)):
            self.number(f"{path}[{i}]", e, a)


def camel(name: str) -> str:
    return re.sub(r"_([a-z])", lambda m: m.group(1).upper(), name)


#: ScoreMeasurements fields that are integer-valued (compared exactly).
_INT_MEASUREMENTS = {"lightnessReversals", "perceivedReversals", "segmentRgbSteps"}


def measurements_dict(m: ScoreMeasurements) -> dict[str, Any]:
    out: dict[str, Any] = {}
    for name in m.__dataclass_fields__:
        value = getattr(m, name)
        out[camel(name)] = list(value) if isinstance(value, tuple) else value
    return out


def compare_measurements(d: Differ, path: str, expected: dict[str, Any], actual: ScoreMeasurements) -> None:
    got = measurements_dict(actual)
    for key, exp in expected.items():
        if key not in got:
            d.diffs.append(f"{path}.{key}: not produced by the port")
        elif key in _INT_MEASUREMENTS:
            d.exact(f"{path}.{key}", exp, got[key])
        elif isinstance(exp, list):
            d.numbers(f"{path}.{key}", exp, got[key])
        else:
            d.number(f"{path}.{key}", exp, got[key])


def _stops_of(case: dict[str, Any]) -> list[dict[str, Any]]:
    return case["stops"]


# ── score / findings ─────────────────────────────────────────────────────────


def _score_common(d: Differ, case: dict[str, Any], result: Any) -> None:
    """The integer / string outputs shared by the score and findings vectors."""
    d.exact("score", case["score"], result.score)
    for dim in ("lightness", "hue", "chroma", "spacing"):
        d.exact(f"details.{dim}", case["details"][dim], getattr(result.details, dim))


def check_score(directory: Path | None = None) -> FileReport:
    data = load_vectors("score", directory)
    report = FileReport("score")
    for case in data["cases"]:
        report.cases += 1
        result = score_gradient(_stops_of(case))
        exact = Differ(report)  # integer / string outputs
        meas = Differ(report)  # floating-point measurements
        if case.get("status") == "unscorable":
            exact.exact("status", "unscorable", result.status)
            exact.exact("reason", case["reason"], result.reason)
            _score_common(exact, case, result)
            exact.exact("issues", case["issues"], list(result.issues))
        else:
            exact.exact("status", "ok", result.status)
            _score_common(exact, case, result)
            exact.exact("issues", case["issues"], list(result.issues))
            if result.details.measurements is None:
                meas.diffs.append("measurements missing")
            else:
                compare_measurements(meas, "measurements", case["measurements"], result.details.measurements)
        _file_case(report, case["name"], case["boundary"], exact.diffs, meas.diffs)
    return report


def _finding_dict(f: Any) -> dict[str, Any]:
    out: dict[str, Any] = {
        "code": f.code,
        "severity": f.severity,
        "dimension": f.dimension,
        "pointsLost": f.points_lost,
    }
    if f.stops is not None:
        out["stops"] = list(f.stops)
    if f.segment is not None:
        out["segment"] = list(f.segment)
    out["message"] = f.message
    return out


def check_findings(directory: Path | None = None) -> FileReport:
    data = load_vectors("findings", directory)
    report = FileReport("findings")
    for case in data["cases"]:
        report.cases += 1
        result = score_gradient(_stops_of(case))
        exact = Differ(report)
        meas = Differ(report)
        exact.exact("status", case["status"], result.status)
        if "reason" in case:
            exact.exact("reason", case["reason"], result.reason)
        _score_common(exact, case, result)
        got_findings = [_finding_dict(f) for f in result.findings]
        exp_findings = case["findings"]
        exact.exact("findings.length", len(exp_findings), len(got_findings))
        for i, (e, a) in enumerate(zip(exp_findings, got_findings)):
            exact.exact(f"findings[{i}]", e, a)
            if list(e) != list(a):  # key order is part of the reference's output
                exact.diffs.append(f"findings[{i}] keys: expected {list(e)}, got {list(a)}")
        measurements = result.details.measurements
        if case["measurements"] is None:
            exact.exact("measurements", None, measurements)
        elif measurements is None:
            meas.diffs.append("measurements missing")
        else:
            compare_measurements(meas, "measurements", case["measurements"], measurements)
            hits = boundary_hits(measurements)
            if hits != case["boundaryHits"] or (len(hits) > 0) != case["boundary"]:
                report.boundary_flag_mismatches += 1
                exact.diffs.append(f"boundaryHits: expected {case['boundaryHits']}, port computes {hits}")
        _file_case(report, case["name"], case["boundary"], exact.diffs, meas.diffs)
    return report


def _file_case(
    report: FileReport, name: str, boundary: bool, exact_diffs: list[str], measurement_diffs: list[str]
) -> None:
    """Apply the PLAN 3.3 policy to one case."""
    for diff in measurement_diffs:  # measurements are required in every case
        report.fail(name, diff)
    if boundary:
        report.boundary += 1
        if not exact_diffs:
            report.boundary_exact_anyway += 1
        return
    report.exact_checked += 1
    for diff in exact_diffs:
        report.fail(name, diff)


# ── suggest ──────────────────────────────────────────────────────────────────


def _boundary_names(directory: Path | None) -> dict[str, bool]:
    return {c["name"]: c["boundary"] for c in load_vectors("findings", directory)["cases"]}


def _stop_dict(s: Any) -> dict[str, Any]:
    return {"id": s.id, "color": s.color, "position": s.position}


def check_suggest(directory: Path | None = None) -> FileReport:
    data = load_vectors("suggest", directory)
    flags = _boundary_names(directory)
    report = FileReport("suggest")
    for case in data["cases"]:
        report.cases += 1
        stops = _stops_of(case)
        diffs = Differ(report)
        suggested = suggest_gradient(stops)
        after = score_gradient(suggested).score
        before = score_gradient(stops).score
        diffs.exact("scoreBefore", case["scoreBefore"], before)
        diffs.exact("scoreAfter", case["scoreAfter"], after)
        diffs.exact("suggested", case["suggested"], [_stop_dict(s) for s in suggested])
        if after < before:
            diffs.diffs.append(f"refine lowered the score ({before} -> {after})")
        _file_case(report, case["name"], flags.get(case["name"], False), diffs.diffs, [])
    return report


# ── interpolate / css ────────────────────────────────────────────────────────


def check_interpolate(directory: Path | None = None) -> FileReport:
    data = load_vectors("interpolate", directory)
    report = FileReport("interpolate")
    counts = data["counts"]
    positions = data["colorAtPositions"]
    for case in data["cases"]:
        report.cases += 1
        stops = _stops_of(case)
        diffs = Differ(report)
        for n in counts:
            diffs.exact(f"samples[{n}]", case["samples"][str(n)], interpolate_gradient(stops, n))
        diffs.exact("colorAt", case["colorAt"], [color_at_position(stops, p) for p in positions])
        _file_case(report, case["name"], False, diffs.diffs, [])
    return report


def _directions(raw: list[dict[str, Any]]) -> list[GradientDirection]:
    return [GradientDirection(d["id"], d["angle"], d["weight"], d["enabled"]) for d in raw]


def check_css(directory: Path | None = None) -> FileReport:
    data = load_vectors("css", directory)
    report = FileReport("css")
    # spreadDirectionAngles: keys are "n" or "n@start".
    report.cases += 1
    diffs = Differ(report)
    for key, expected in data["spreadDirectionAngles"].items():
        n, _, start = key.partition("@")
        got = spread_direction_angles(int(n), int(start)) if start else spread_direction_angles(int(n))
        diffs.exact(f"spreadDirectionAngles[{key}]", expected, got)
    _file_case(report, "spreadDirectionAngles", False, diffs.diffs, [])
    for case in data["cases"]:
        report.cases += 1
        stops = _stops_of(case)
        diffs = Differ(report)
        diffs.exact("css", case["css"], build_gradient_css(stops, case["angle"]))
        multi = build_multi_gradient_style(stops, _directions(case["directions"]), case["blend"])
        diffs.exact("multi.background", case["multi"]["background"], multi.background)
        diffs.exact("multi.backgroundBlendMode", case["multi"]["backgroundBlendMode"], multi.background_blend_mode)
        _file_case(report, case["name"], False, diffs.diffs, [])
    return report


# ── colour ───────────────────────────────────────────────────────────────────


def _rgb(d: Differ, path: str, expected: dict[str, float], actual: RGB, exact: bool) -> None:
    for ch in ("r", "g", "b"):
        if exact:
            d.exact(f"{path}.{ch}", expected[ch], getattr(actual, ch))
        else:
            d.number(f"{path}.{ch}", expected[ch], getattr(actual, ch))


def _lab(d: Differ, path: str, expected: dict[str, float], actual: Oklab) -> None:
    for ch in ("L", "a", "b"):
        d.number(f"{path}.{ch}", expected[ch], getattr(actual, ch))


def _lch(d: Differ, path: str, expected: dict[str, float], actual: Lch, *, hue: bool = True) -> None:
    d.number(f"{path}.L", expected["L"], actual.L)
    d.number(f"{path}.C", expected["C"], actual.C)
    # The hue of an (almost) achromatic colour is the angle of floating-point noise.
    if hue and expected["C"] > 1e-6:
        d.number(f"{path}.h", expected["h"], actual.h)


def _hsl(d: Differ, path: str, expected: dict[str, float], actual: HSL, exact: bool) -> None:
    for ch in ("h", "s", "l"):
        if exact:
            d.exact(f"{path}.{ch}", expected[ch], getattr(actual, ch))
        else:
            d.number(f"{path}.{ch}", expected[ch], getattr(actual, ch))


def _check_color_case(report: FileReport, case: dict[str, Any]) -> list[str]:
    d = Differ(report)
    out = case["out"]
    kind = case["kind"]
    if kind == "hex":
        hex_ = case["input"]
        rgb = hex_to_rgb(hex_)
        lab = rgb_to_oklab(rgb)
        lch = hex_to_oklch(hex_)
        _rgb(d, "rgb", out["rgb"], rgb, True)
        _lab(d, "oklab", out["oklab"], lab)
        _lch(d, "oklch", out["oklch"], lch)
        d.exact("oklchToHex", out["oklchToHex"], oklch_to_hex(lch))
        _hsl(d, "hslPrecise", out["hslPrecise"], hex_to_hsl_precise(hex_), False)
        _hsl(d, "hsl", out["hsl"], hex_to_hsl(hex_), True)
        d.exact("formatHex", out["formatHex"], format_hex(hex_))
        d.exact("formatRgb", out["formatRgb"], format_rgb(hex_))
        d.exact("formatHsl", out["formatHsl"], format_hsl(hex_))
        d.exact("formatName", out["formatName"], format_name(hex_))
        d.exact("formatNameDisplay", out["formatNameDisplay"], format_name_display(hex_))
        match = nearest_color_name(hex_)
        d.exact("nearestName", out["nearestName"], {"name": match.name, "exact": match.exact})
        d.exact("complement", out["complement"], complement_hex(hex_))
    elif kind == "parse":
        text = case["input"]
        d.exact("hex", out["hex"], parse_hex(text))
        d.exact("rgb", out["rgb"], parse_rgb(text))
        d.exact("hsl", out["hsl"], parse_hsl(text))
        d.exact("name", out["name"], parse_name(text))
        d.exact("any", out["any"], parse_any_color(text))
    elif kind == "lch":
        raw = case["input"]
        lch = Lch(raw["L"], raw["C"], raw["h"])
        lab = lch_to_oklab(lch)
        _lab(d, "toOklab", out["toOklab"], lab)
        _rgb(d, "linearRgb", out["linearRgb"], oklab_to_linear_rgb(lab), False)
        _rgb(d, "rgb", out["rgb"], oklab_to_rgb(lab), True)
        d.exact("hex", out["hex"], oklch_to_hex(lch))
        fit = gamut_fit_oklch(lch)
        d.number("gamutFit.C", out["gamutFit"]["C"], fit.C)
        d.number("gamutFit.L", out["gamutFit"]["L"], fit.L)
        d.number("gamutFit.h", out["gamutFit"]["h"], fit.h)
        d.exact("fittedHex", out["fittedHex"], oklch_to_hex_fitted(lch))
    elif kind == "scalar":
        v = case["input"]
        d.number("srgbToLinear", out["srgbToLinear"], srgb_to_linear(v))
        d.exact("linearToSrgb", out["linearToSrgb"], linear_to_srgb(v))
    elif kind == "hsl":
        raw = case["input"]
        hsl = HSL(raw["h"], raw["s"], raw["l"])
        _rgb(d, "rgb", out["rgb"], hsl_to_rgb(hsl), True)
        d.exact("hex", out["hex"], hsl_to_hex(hsl))
        d.exact("rgbToHex", out["rgbToHex"], rgb_to_hex(hsl_to_rgb(hsl)))
    else:  # pragma: no cover - a new vector kind must be ported deliberately
        d.diffs.append(f"unknown colour case kind {kind!r}")
    return d.diffs


def check_color(directory: Path | None = None) -> FileReport:
    data = load_vectors("color", directory)
    report = FileReport("color")
    for case in data["cases"]:
        report.cases += 1
        label = f"{case['kind']} {json.dumps(case['input'], ensure_ascii=True)}"
        _file_case(report, label, False, _check_color_case(report, case), [])
    return report


CHECKS = {
    "score": check_score,
    "findings": check_findings,
    "suggest": check_suggest,
    "interpolate": check_interpolate,
    "css": check_css,
    "color": check_color,
}


def run_all(directory: Path | None = None) -> list[FileReport]:
    return [CHECKS[name](directory) for name in VECTOR_FILES]


def format_summary(reports: list[FileReport]) -> str:
    lines = [
        f"{'vectors':<12} {'cases':>6} {'exact':>6} {'boundary':>9} {'b.exact':>8} {'mismatch':>9}"
        f"  {'floats':>7} {'bit-exact':>9} {'max rel':>9} {'max abs':>9}"
    ]
    totals = [0, 0, 0, 0, 0, 0, 0]
    for r in reports:
        lines.append(
            f"v1-{r.name:<9} {r.cases:>6} {r.exact_checked:>6} {r.boundary:>9} {r.boundary_exact_anyway:>8} "
            f"{len(r.mismatches):>9}  {r.floats.values:>7} {r.floats.bit_exact:>9} {r.floats.max_rel:>9.1e} {r.floats.max_abs:>9.1e}"
        )
        for i, v in enumerate(
            (r.cases, r.exact_checked, r.boundary, r.boundary_exact_anyway, len(r.mismatches), r.floats.values, r.floats.bit_exact)
        ):
            totals[i] += v
    lines.append(
        f"{'total':<12} {totals[0]:>6} {totals[1]:>6} {totals[2]:>9} {totals[3]:>8} {totals[4]:>9}"
        f"  {totals[5]:>7} {totals[6]:>9}"
    )
    lines.append(
        "exact = non-boundary cases compared exactly; boundary = flagged cases, measurements only required; "
        "b.exact = boundary cases whose integer outputs matched anyway"
    )
    return "\n".join(lines)


