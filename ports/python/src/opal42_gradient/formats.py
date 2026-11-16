"""Colour formats: parsing, formatting, names, HSL, gamut fitting, complements.

Port of ``packages/core/src/color-formats.ts``.  Regular expressions are
rewritten with explicit ASCII classes and ``fullmatch`` so that they behave like
the JavaScript originals (``\\d``, ``\\s``, ``\\b``, ``$`` and ``/i`` all differ
between the two engines for non-ASCII or newline-bearing input; see
``docs/python.md``).
"""

from __future__ import annotations

import math
import re
from dataclasses import dataclass
from typing import Final

from ._jsnum import JS_WHITESPACE, clamp, js_fmod, js_number_str, js_parse_float, js_round, js_trim
from ._names_table import CSS_COLOR_NAMES, CSS_NAMED_COLORS
from .colorspace import (
    RGB,
    Lch,
    hex_to_rgb,
    lch_to_oklab,
    oklab_to_lch,
    oklab_to_linear_rgb,
    oklab_to_rgb,
    rgb_to_hex,
    rgb_to_oklab,
)

__all__ = [
    "ColorNameMatch",
    "CSS_COLOR_NAMES",
    "CSS_NAMED_COLORS",
    "HSL",
    "complement_hex",
    "format_hex",
    "format_hsl",
    "format_name",
    "format_name_display",
    "format_rgb",
    "gamut_fit_oklch",
    "hex_to_hsl",
    "hex_to_hsl_precise",
    "hsl_to_hex",
    "hsl_to_rgb",
    "nearest_color_name",
    "oklch_to_hex_fitted",
    "parse_any_color",
    "parse_hex",
    "parse_hsl",
    "parse_name",
    "parse_rgb",
    "rgb_to_hsl",
    "rgb_to_hsl_precise",
]

_WS = JS_WHITESPACE  # spliced into character classes below (none of its characters is special there)
_NUM = r"-?[0-9]*\.?[0-9]+"
_FLAGS = re.ASCII


# ── Names ────────────────────────────────────────────────────────────────────

# First name wins for each hex (aqua over cyan, gray over grey), in reference order.
_HEX_TO_NAME: Final[dict[str, str]] = {}
for _name, _hex in CSS_NAMED_COLORS.items():
    _HEX_TO_NAME.setdefault(_hex, _name)

_NAMED_LABS: Final = tuple((name, rgb_to_oklab(hex_to_rgb(hex_))) for hex_, name in _HEX_TO_NAME.items())


@dataclass(frozen=True)
class ColorNameMatch:
    name: str
    #: True when the hex is exactly the named colour, False when it is the nearest.
    exact: bool


def nearest_color_name(hex_color: str) -> ColorNameMatch:
    """Nearest CSS named colour, measured as OKLab delta E (squared distance, first wins ties)."""
    canonical = hex_color.lower()
    exact = _HEX_TO_NAME.get(canonical)
    if exact is not None:
        return ColorNameMatch(exact, True)

    lab = rgb_to_oklab(hex_to_rgb(canonical))
    best_name, best_dist = _NAMED_LABS[0][0], math.inf
    for name, cand in _NAMED_LABS:
        dl, da, db = lab.L - cand.L, lab.a - cand.a, lab.b - cand.b
        d = dl * dl + da * da + db * db
        if d < best_dist:
            best_dist = d
            best_name = name
    return ColorNameMatch(best_name, False)


# ── HSL ──────────────────────────────────────────────────────────────────────


@dataclass(frozen=True)
class HSL:
    """Hue in degrees, saturation and lightness in percent."""

    h: float
    s: float
    l: float  # noqa: E741


def rgb_to_hsl_precise(rgb: RGB) -> HSL:
    """sRGB to HSL at full precision."""
    rn, gn, bn = rgb.r / 255, rgb.g / 255, rgb.b / 255
    hi = max(rn, gn, bn)
    lo = min(rn, gn, bn)
    lightness = (hi + lo) / 2
    d = hi - lo

    h: float = 0
    s: float = 0
    if d > 0:
        s = d / (2 - hi - lo) if lightness > 0.5 else d / (hi + lo)
        if hi == rn:
            h = (gn - bn) / d + (6 if gn < bn else 0)
        elif hi == gn:
            h = (bn - rn) / d + 2
        else:
            h = (rn - gn) / d + 4
        h *= 60
    return HSL(h, s * 100, lightness * 100)


def rgb_to_hsl(rgb: RGB) -> HSL:
    """sRGB to HSL rounded to whole degrees and percents, for display (lossy)."""
    p = rgb_to_hsl_precise(rgb)
    return HSL(js_fmod(js_round(p.h), 360), js_round(p.s), js_round(p.l))


def hsl_to_rgb(hsl: HSL) -> RGB:
    hue = js_fmod(js_fmod(hsl.h, 360) + 360, 360) / 60
    sat = clamp(hsl.s, 0, 100) / 100
    lum = clamp(hsl.l, 0, 100) / 100

    c = (1 - abs(2 * lum - 1)) * sat
    x = c * (1 - abs(js_fmod(hue, 2) - 1))
    m = lum - c / 2

    rgb: tuple[float, float, float]
    if hue < 1:
        rgb = (c, x, 0)
    elif hue < 2:
        rgb = (x, c, 0)
    elif hue < 3:
        rgb = (0, c, x)
    elif hue < 4:
        rgb = (0, x, c)
    elif hue < 5:
        rgb = (x, 0, c)
    else:
        rgb = (c, 0, x)
    return RGB(js_round((rgb[0] + m) * 255), js_round((rgb[1] + m) * 255), js_round((rgb[2] + m) * 255))


def hex_to_hsl(hex_color: str) -> HSL:
    """Display-ready HSL (integers)."""
    return rgb_to_hsl(hex_to_rgb(hex_color))


def hex_to_hsl_precise(hex_color: str) -> HSL:
    """Full-precision HSL, for preserving channels the user did not edit."""
    return rgb_to_hsl_precise(hex_to_rgb(hex_color))


def hsl_to_hex(hsl: HSL) -> str:
    return rgb_to_hex(hsl_to_rgb(hsl))


# ── Formatting ───────────────────────────────────────────────────────────────


def format_hex(hex_color: str) -> str:
    return hex_color.upper()


def format_rgb(hex_color: str) -> str:
    rgb = hex_to_rgb(hex_color)
    return f"rgb({js_number_str(rgb.r)}, {js_number_str(rgb.g)}, {js_number_str(rgb.b)})"


def format_hsl(hex_color: str) -> str:
    hsl = hex_to_hsl(hex_color)
    return f"hsl({js_number_str(hsl.h)}, {js_number_str(hsl.s)}%, {js_number_str(hsl.l)}%)"


def format_name(hex_color: str) -> str:
    """Named colour, prefixed with ``~`` when it is an approximation."""
    m = nearest_color_name(hex_color)
    return m.name if m.exact else f"~{m.name}"


def format_name_display(hex_color: str) -> str:
    """Display form of a name: ``nearest: midnightblue`` when only an approximation."""
    m = nearest_color_name(hex_color)
    return m.name if m.exact else f"nearest: {m.name}"


# ── Parsing ──────────────────────────────────────────────────────────────────

_TOKEN = re.compile(rf"{_NUM}[{_WS}]*%?", _FLAGS)


def _numeric_tokens(raw: str) -> list[tuple[float, bool]]:
    """``(value, is_percent)`` for the numbers in a functional notation or bare triple."""
    out: list[tuple[float, bool]] = []
    for token in _TOKEN.findall(raw):
        value = js_parse_float(token)
        if math.isfinite(value):
            out.append((value, "%" in token))
    return out


_HEX_BODY = re.compile(r"[0-9a-fA-F]+", _FLAGS)


def parse_hex(raw: str) -> str | None:
    """Hex in any shape people paste: with or without ``#``, 3, 4, 6 or 8 digits.

    Alpha digits are accepted and dropped: the engine is opaque.
    """
    body = js_trim(raw)
    if body.startswith("#"):
        body = body[1:]
    if _HEX_BODY.fullmatch(body) is None:
        return None
    if len(body) in (3, 4):
        six = "".join(c + c for c in body[:3])
    elif len(body) in (6, 8):
        six = body[:6]
    else:
        return None
    return f"#{six.lower()}"


_RGB_OPEN = re.compile(r"^rgba?[" + _WS + r"]*\(", _FLAGS | re.IGNORECASE)
_HSL_OPEN = re.compile(r"^hsla?[" + _WS + r"]*\(", _FLAGS | re.IGNORECASE)
_CLOSE = re.compile(r"\)[" + _WS + r"]*\Z", _FLAGS)


def _strip_function(raw: str, opener: re.Pattern[str]) -> str:
    return _CLOSE.sub("", opener.sub("", js_trim(raw), count=1), count=1)


def parse_rgb(raw: str) -> str | None:
    """``rgb(1 2 3 / 50%)``, ``rgba(1,2,3,.5)``, ``50% 20% 100%`` or a bare ``1, 2, 3``."""
    tokens = _numeric_tokens(_strip_function(raw, _RGB_OPEN))
    if len(tokens) < 3:
        return None
    channels = []
    for value, percent in tokens[:3]:
        v = (value / 100) * 255 if percent else value
        channels.append(js_round(clamp(v, 0, 255)))
    return rgb_to_hex(RGB(channels[0], channels[1], channels[2]))


_HUE_UNIT = re.compile(rf"{_NUM}[{_WS}]*(deg|grad|rad|turn)", _FLAGS | re.IGNORECASE)


def parse_hsl(raw: str) -> str | None:
    """``hsl(210, 50%, 40%)``, ``hsl(210deg 50% 40% / 80%)`` or a bare ``210 50 40``."""
    body = _strip_function(raw, _HSL_OPEN)
    tokens = _numeric_tokens(body)
    if len(tokens) < 3:
        return None

    # The hue may carry a unit; everything else is a percentage of its own range.
    unit_match = _HUE_UNIT.search(body)
    unit = unit_match.group(1).lower() if unit_match else None
    h = tokens[0][0]
    if unit == "turn":
        h *= 360
    elif unit == "rad":
        h *= 180 / math.pi
    elif unit == "grad":
        h *= 0.9

    def as_percent(token: tuple[float, bool]) -> float:
        value, percent = token
        return value if percent or value > 1 else value * 100

    return hsl_to_hex(HSL(h, as_percent(tokens[1]), as_percent(tokens[2])))


_NAME_PREFIX = re.compile(r"^(?:~|nearest[" + _WS + r"]*:)", _FLAGS)
_NAME_SEPARATORS = re.compile(r"[" + _WS + r"_-]", _FLAGS)


def parse_name(raw: str) -> str | None:
    """A CSS colour keyword.  Tolerates spaces, casing and a leading ``~`` or ``nearest:``."""
    key = _NAME_SEPARATORS.sub("", _NAME_PREFIX.sub("", js_trim(raw).lower(), count=1))
    return CSS_NAMED_COLORS.get(key)


_GRADIENT_CALL = re.compile(r"gradient[" + _WS + r"]*\(", _FLAGS | re.IGNORECASE)
_COLOR_FUNCTION = re.compile(r"\b(?:rgba?|hsla?)[" + _WS + r"]*\(", _FLAGS | re.IGNORECASE)
_SINGLE_CALL = re.compile(r"[^()]*\([^()]*\)?[" + _WS + r"]*\Z", _FLAGS)
_BARE_TRIPLE = re.compile(
    r"[0-9" + _WS + r".,%/+-]+(?:deg|grad|rad|turn)?[0-9" + _WS + r".,%/+-]*\Z", _FLAGS | re.IGNORECASE
)


def parse_any_color(raw: str) -> str | None:
    """Best-effort parse of arbitrary text: what a paste button uses.

    A gradient, or anything else holding several colours, is not "a colour".
    """
    text = js_trim(raw)
    if not text:
        return None
    if _GRADIENT_CALL.search(text):
        return None
    if text.count("#") + len(_COLOR_FUNCTION.findall(text)) > 1:
        return None

    if _RGB_OPEN.match(text):
        return parse_rgb(text) if _SINGLE_CALL.fullmatch(text) else None
    if _HSL_OPEN.match(text):
        return parse_hsl(text) if _SINGLE_CALL.fullmatch(text) else None
    if text.startswith("#"):
        return parse_hex(text)

    named = parse_name(text)
    if named:
        return named
    hex_ = parse_hex(text)
    if hex_:
        return hex_

    # Bare triples: percent signs read as HSL, plain numbers as RGB.
    if _BARE_TRIPLE.fullmatch(text) is None:
        return None
    tokens = _numeric_tokens(text)
    if len(tokens) >= 3:
        looks_hsl = any(percent for _, percent in tokens[1:3])
        return parse_hsl(text) if looks_hsl else parse_rgb(text)
    return None


# ── Gamut mapping ────────────────────────────────────────────────────────────


def _is_in_gamut(lch: Lch) -> bool:
    lin = oklab_to_linear_rgb(lch_to_oklab(lch))
    eps = 1e-4
    return all(-eps <= v <= 1 + eps for v in (lin.r, lin.g, lin.b))


def gamut_fit_oklch(lch: Lch) -> Lch:
    """Pull an OKLCH colour back into sRGB by reducing chroma (lightness and hue held)."""
    if _is_in_gamut(lch):
        return lch
    lo: float = 0
    hi = lch.C
    for _ in range(16):
        mid = (lo + hi) / 2
        if _is_in_gamut(Lch(lch.L, mid, lch.h)):
            lo = mid
        else:
            hi = mid
    return Lch(lch.L, lo, lch.h)


def oklch_to_hex_fitted(lch: Lch) -> str:
    return rgb_to_hex(oklab_to_rgb(lch_to_oklab(gamut_fit_oklch(lch))))


# ── Complements ──────────────────────────────────────────────────────────────


def complement_hex(hex_color: str) -> str:
    """The complement of a colour: opposite OKLCH hue, same lightness and chroma, gamut-mapped.

    Near-achromatic inputs (C < 0.02) have no hue to rotate, so they mirror
    lightness instead.
    """
    lch = oklab_to_lch(rgb_to_oklab(hex_to_rgb(hex_color)))
    if lch.C < 0.02:
        return oklch_to_hex_fitted(Lch(clamp(1 - lch.L, 0, 1), lch.C, lch.h))
    return oklch_to_hex_fitted(Lch(lch.L, lch.C, js_fmod(lch.h + 180, 360)))
