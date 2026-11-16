"""sRGB <-> linear <-> OKLab <-> OKLCH conversions.

Port of the colour maths in ``packages/core/src/gradient-engine.ts``.  The
constants, the order of operations and the rounding are the reference's; where
JavaScript and Python disagree the JavaScript behaviour is reproduced (see
``_jsnum``):

* ``linear_to_srgb`` and ``rgb_to_hex`` round with :func:`js_round`
  (``Math.round``: halves go up);
* ``Math.cbrt`` is :func:`js_cbrt`;
* angle wrapping uses ``fmod`` (JavaScript's ``%``).

Channels are 0..255 numbers (not 0..1), hue is in degrees, as in the reference.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

from ._jsnum import clamp, js_cbrt, js_fmod, js_round

__all__ = [
    "Lch",
    "Oklab",
    "RGB",
    "hex_to_oklch",
    "hex_to_rgb",
    "lch_to_oklab",
    "linear_to_srgb",
    "oklab_delta_e",
    "oklab_to_lch",
    "oklab_to_linear_rgb",
    "oklab_to_rgb",
    "oklch_to_hex",
    "rgb_to_hex",
    "rgb_to_oklab",
    "srgb_to_linear",
]


@dataclass(frozen=True)
class RGB:
    """sRGB channels, 0..255 (integers after rounding, floats before)."""

    r: float
    g: float
    b: float


@dataclass(frozen=True)
class Oklab:
    L: float
    a: float
    b: float


@dataclass(frozen=True)
class Lch:
    """OKLCH: lightness 0..1, chroma >= 0, hue in degrees."""

    L: float
    C: float
    h: float


def srgb_to_linear(c: float) -> float:
    """One sRGB channel (0..255) to linear light (0..1)."""
    c = c / 255
    return c / 12.92 if c <= 0.04045 else math.pow((c + 0.055) / 1.055, 2.4)


def linear_to_srgb(c: float) -> int:
    """Linear light (clamped to 0..1) to an 8-bit sRGB channel (``Math.round``)."""
    clamped = clamp(c, 0, 1)
    return js_round(
        255 * (12.92 * clamped if clamped <= 0.0031308 else 1.055 * math.pow(clamped, 1 / 2.4) - 0.055)
    )


def hex_to_rgb(hex_color: str) -> RGB:
    """``#rrggbb`` to channels.  Raises ``ValueError`` for anything else.

    (The reference's ``hexToRgb`` yields NaN for garbage; every scoring entry
    point validates first, so this port raises instead of propagating NaN.)
    """
    if (
        not isinstance(hex_color, str)
        or len(hex_color) != 7
        or hex_color[0] != "#"
        or any(ch not in "0123456789abcdefABCDEF" for ch in hex_color[1:])
    ):
        raise ValueError(f"not a #rrggbb colour: {hex_color!r}")
    return RGB(int(hex_color[1:3], 16), int(hex_color[3:5], 16), int(hex_color[5:7], 16))


def rgb_to_hex(rgb: RGB) -> str:
    """Channels to lower-case ``#rrggbb``, rounding (``Math.round``) and clamping to 0..255."""
    return "#" + "".join(format(max(0, min(255, js_round(v))), "02x") for v in (rgb.r, rgb.g, rgb.b))


def rgb_to_oklab(rgb: RGB) -> Oklab:
    lr = srgb_to_linear(rgb.r)
    lg = srgb_to_linear(rgb.g)
    lb = srgb_to_linear(rgb.b)

    l = js_cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb)  # noqa: E741
    m = js_cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb)
    s = js_cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb)

    return Oklab(
        L=0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
        a=1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
        b=0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s,
    )


def oklab_to_linear_rgb(lab: Oklab) -> RGB:
    """OKLab to *linear* sRGB without clamping or gamma encoding.

    Values outside 0..1 mean the colour is outside the sRGB gamut.
    """
    l_ = lab.L + 0.3963377774 * lab.a + 0.2158037573 * lab.b
    m_ = lab.L - 0.1055613458 * lab.a - 0.0638541728 * lab.b
    s_ = lab.L - 0.0894841775 * lab.a - 1.2914855480 * lab.b

    l = l_ * l_ * l_  # noqa: E741
    m = m_ * m_ * m_
    s = s_ * s_ * s_

    return RGB(
        r=+4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
        g=-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
        b=-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
    )


def oklab_to_rgb(lab: Oklab) -> RGB:
    lin = oklab_to_linear_rgb(lab)
    return RGB(linear_to_srgb(lin.r), linear_to_srgb(lin.g), linear_to_srgb(lin.b))


def oklab_to_lch(lab: Oklab) -> Lch:
    chroma = math.sqrt(lab.a * lab.a + lab.b * lab.b)
    h = math.atan2(lab.b, lab.a) * (180 / math.pi)
    return Lch(lab.L, chroma, js_fmod(js_fmod(h, 360) + 360, 360))


def lch_to_oklab(lch: Lch) -> Oklab:
    hr = lch.h * (math.pi / 180)
    return Oklab(lch.L, lch.C * math.cos(hr), lch.C * math.sin(hr))


def hex_to_oklch(hex_color: str) -> Lch:
    """``#rrggbb`` to OKLCH in one step."""
    return oklab_to_lch(rgb_to_oklab(hex_to_rgb(hex_color)))


def oklch_to_hex(lch: Lch) -> str:
    """OKLCH to ``#rrggbb`` in one step (out-of-gamut channels clip)."""
    return rgb_to_hex(oklab_to_rgb(lch_to_oklab(lch)))


def oklab_delta_e(a: Oklab, b: Oklab) -> float:
    """Euclidean distance in OKLab.  (``x * x`` is what the reference's ``** 2`` computes.)"""
    dl = a.L - b.L
    da = a.a - b.a
    db = a.b - b.b
    return math.sqrt(dl * dl + da * da + db * db)
