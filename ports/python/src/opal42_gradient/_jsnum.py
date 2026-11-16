"""JavaScript number and string semantics that the scoring model depends on.

The reference implementation is TypeScript running on V8.  Python differs from
JavaScript in a handful of small, silent ways, and each of them can move a
colour channel by one level or a score by several points.  Every difference
that matters for v1 is isolated in this module so it is documented once:

``js_round``
    ``Math.round`` rounds half **towards +infinity** (2.5 -> 3, -2.5 -> -2).
    Python's ``round`` rounds half to even (2.5 -> 2).
``js_fmod``
    JavaScript's ``%`` is C ``fmod`` (the result takes the sign of the
    dividend).  Python's ``%`` is floored modulo.  The reference writes angle
    wrapping as ``((x % 360) + 360) % 360``; using Python's ``%`` there changes
    the last bits of the result, so ``math.fmod`` is used instead.
``js_cbrt``
    ``Math.cbrt``.  ``math.cbrt`` only exists from Python 3.11 and defers to the
    platform libm.  V8 uses a port of FreeBSD's ``s_cbrt.c``; that algorithm is
    reproduced here so that the result is the same on every Python version and
    platform.
``js_number_str``
    ``String(number)``: ``1`` not ``1.0``, ``1e-7`` not ``1e-07``.
``js_trim`` / ``JS_WHITESPACE`` / ``js_parse_float``
    ``String.prototype.trim``, the ``\\s`` class and ``parseFloat``.
"""

from __future__ import annotations

import math
import re
import struct
from decimal import Decimal

__all__ = [
    "JS_WHITESPACE",
    "clamp",
    "js_cbrt",
    "js_fmod",
    "js_number_str",
    "js_parse_float",
    "js_round",
    "js_trim",
]

#: Characters that are whitespace or line terminators to ECMAScript (``\s`` and
#: ``trim``).  Python's ``str.isspace`` differs (it includes U+001C..U+001F and
#: excludes U+FEFF).
JS_WHITESPACE = (
    "\t\n\u000b\u000c\r          "
    "        　﻿"
)


def js_trim(text: str) -> str:
    """``String.prototype.trim``."""
    return text.strip(JS_WHITESPACE)


def clamp(value: float, low: float, high: float) -> float:
    """The reference's ``clamp``; NaN passes through unchanged."""
    return low if value < low else high if value > high else value


def js_round(x: float) -> int:
    """``Math.round``: halves round towards +infinity (``-2.5`` -> ``-2``).

    ``floor(x + 0.5)`` is *not* equivalent (``0.49999999999999994 + 0.5 == 1.0``
    in floating point, but ``Math.round(0.49999999999999994)`` is 0), so the
    fractional part is taken exactly with ``x - floor(x)``, which is exact for
    every finite double.  Non-finite input is returned unchanged (as a float),
    like JavaScript.
    """
    if isinstance(x, int):
        return x
    if not math.isfinite(x):
        return x  # type: ignore[return-value]
    floor = math.floor(x)
    return floor + 1 if x - floor >= 0.5 else floor


def js_fmod(x: float, y: float) -> float:
    """JavaScript's ``%`` operator for numbers (C ``fmod``)."""
    return math.fmod(x, y)


# ── Math.cbrt (FreeBSD s_cbrt.c, as used by V8) ──────────────────────────────

_B1 = 715094163  # (1023 - 1023/3 - 0.03306235651) * 2**20
_B2 = 696219795  # (1023 - 1023/3 - 54/3 - 0.03306235651) * 2**20
_P0 = 1.87595182427177009643
_P1 = -1.88497979543377169875
_P2 = 1.621429720105354466140
_P3 = -0.758397934778766047437
_P4 = 0.145996192886612446982


def _bits(x: float) -> int:
    return int(struct.unpack(">Q", struct.pack(">d", x))[0])


def _from_bits(bits: int) -> float:
    return float(struct.unpack(">d", struct.pack(">Q", bits))[0])


def _words(x: float) -> tuple[int, int]:
    bits = _bits(x)
    return bits >> 32, bits & 0xFFFFFFFF


def _from_words(high: int, low: int = 0) -> float:
    return _from_bits(((high & 0xFFFFFFFF) << 32) | (low & 0xFFFFFFFF))


def js_cbrt(x: float) -> float:
    """Cube root, bit-identical to V8's ``Math.cbrt`` (error < 0.667 ulp)."""
    high, low = _words(x)
    sign = high & 0x80000000
    hx = high ^ sign
    if hx >= 0x7FF00000:
        return x + x  # NaN and +-inf are their own cube root
    if hx < 0x00100000:  # zero or subnormal
        if (hx | low) == 0:
            return x
        t = _from_words(0x43500000) * x  # scale by 2**54
        high_t, _ = _words(t)
        t = _from_words(sign | ((high_t & 0x7FFFFFFF) // 3 + _B2))
    else:
        t = _from_words(sign | (hx // 3 + _B1))

    # New cbrt to 23 bits: cbrt(x) = t * cbrt(x / t**3) ~= t * P(t**3 / x).
    r = (t * t) * (t / x)
    t = t * ((_P0 + r * (_P1 + r * _P2)) + ((r * r) * r) * (_P3 + r * _P4))

    # Round t away from zero to 23 bits, then one Newton step to 53 bits.
    t = _from_bits((_bits(t) + 0x80000000) & 0xFFFFFFFFC0000000)
    s = t * t
    r = x / s
    w = t + t
    r = (r - t) / (w + r)
    return t + t * r


# ── Number -> string ─────────────────────────────────────────────────────────


def js_number_str(x: float) -> str:
    """``String(x)`` for a JavaScript number (also accepts Python ints)."""
    if isinstance(x, bool):
        raise TypeError("bool is not a JavaScript number")
    if isinstance(x, int):
        return str(x)
    if x != x:
        return "NaN"
    if x == math.inf:
        return "Infinity"
    if x == -math.inf:
        return "-Infinity"
    if x == 0:
        return "0"
    sign = "-" if x < 0 else ""
    _, digit_tuple, raw_exponent = Decimal(repr(abs(x))).as_tuple()
    assert isinstance(raw_exponent, int)  # finite
    all_digits = "".join(map(str, digit_tuple))
    digits = all_digits.rstrip("0") or "0"
    exponent = raw_exponent + len(all_digits) - len(digits)  # trailing zeros moved into the exponent
    k = len(digits)
    n = k + exponent  # value = 0.<digits> * 10**n
    if k <= n <= 21:
        body = digits + "0" * (n - k)
    elif 0 < n <= 21:
        body = digits[:n] + "." + digits[n:]
    elif -6 < n <= 0:
        body = "0." + "0" * (-n) + digits
    else:
        e = n - 1
        mantissa = digits[0] + ("." + digits[1:] if k > 1 else "")
        body = f"{mantissa}e{'+' if e >= 0 else '-'}{abs(e)}"
    return sign + body


# ── parseFloat ───────────────────────────────────────────────────────────────

_FLOAT_PREFIX = re.compile(
    r"[+-]?(?:Infinity|(?:[0-9]+\.?[0-9]*|\.[0-9]+)(?:[eE][+-]?[0-9]+)?)", re.ASCII
)


def js_parse_float(text: str) -> float:
    """``parseFloat``: the longest numeric prefix after leading whitespace, else NaN."""
    match = _FLOAT_PREFIX.match(text.lstrip(JS_WHITESPACE))
    if match is None:
        return math.nan
    return float(match.group(0))
