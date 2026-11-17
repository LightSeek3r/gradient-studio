"""Tolerance-aware selection (defect D8): port of ``packages/core/src/tolerance.ts``.

Wherever a floating-point comparison chooses WHICH stop, segment or candidate is
reported, values within :data:`EPS` are ties and the lowest index wins, so the
choice no longer depends on the last bit of ``pow`` / ``cbrt`` / ``atan2`` (which
differ between libms, interpreters and JavaScript engines).  Measurements and
threshold tests are unchanged.  See ``docs/DETERMINISM.md``.
"""

from __future__ import annotations

import math
from collections.abc import Sequence
from typing import Final, Literal

#: Relative tolerance (absolute below magnitude 1).
EPS: Final = 1e-9


def tolerance(a: float, b: float, eps: float = EPS) -> float:
    return eps * max(1.0, abs(a), abs(b))


def approx_eq(a: float, b: float, eps: float = EPS) -> bool:
    """``|a - b| <= eps * max(1, |a|, |b|)``; False if either is NaN."""
    if math.isnan(a) or math.isnan(b):
        return False
    return abs(a - b) <= tolerance(a, b, eps)


def arg_best(values: Sequence[float], mode: Literal["min", "max"], eps: float = EPS) -> int:
    """Index of the smallest / largest value; ties within EPS go to the lowest index. NaN is ignored; -1 if none."""
    extreme = math.nan
    for v in values:
        if math.isnan(v):
            continue
        if math.isnan(extreme) or (v < extreme if mode == "min" else v > extreme):
            extreme = v
    if math.isnan(extreme):
        return -1
    for i, v in enumerate(values):
        if approx_eq(v, extreme, eps):
            return i
    return -1


def hue_arc_ends(by_hue: Sequence[int], h: Sequence[float]) -> list[int]:
    """``hueArcEnds`` of the reference: ``[start, end]`` stops of the minimum enclosing hue arc.

    ``by_hue`` is the chromatic stop indices in (hue, index) order.  Hues within EPS
    (chained, and across 0/360) form one group; the start is the lowest index of
    the group after the largest gap, the end the highest index of the group before
    it; tied largest gaps go to the lowest start index; one group gives its lowest
    and highest index.
    """
    groups: list[list[int]] = []
    for k, i in enumerate(by_hue):
        if k > 0 and approx_eq(h[i], h[by_hue[k - 1]]):
            groups[-1].append(i)
        else:
            groups.append([i])
    if len(groups) > 1 and approx_eq(h[groups[0][0]] + 360, h[groups[-1][-1]]):
        groups[0] = groups[-1] + groups[0]
        groups.pop()
    if len(groups) == 1:
        return [min(groups[0]), max(groups[0])]
    count = len(groups)
    gaps: list[float] = []
    for c in range(count):
        d = h[groups[(c + 1) % count][0]] - h[groups[c][-1]]
        if d < 0:
            d += 360
        gaps.append(d)
    largest = max(gaps)
    best: list[int] | None = None
    for c in range(count):
        if not approx_eq(gaps[c], largest):
            continue
        start = min(groups[(c + 1) % count])
        if best is None or start < best[0]:
            best = [start, max(groups[c])]
    assert best is not None
    return best
