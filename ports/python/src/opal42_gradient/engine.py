"""Gradient scoring (model v1), refinement, CSS building and interpolation.

Port of ``packages/core/src/gradient-engine.ts`` (the reference).  Positions are
percentages 0..100, as in the reference's legacy engine API.

Faithfulness notes (details in ``docs/python.md``):

* every sum and every population variance is an explicit left-to-right loop.
  ``sum()`` is *not* used for floats: since Python 3.12 it applies compensated
  summation and would differ from JavaScript's ``reduce`` in the last bit;
* ``Math.round`` is :func:`~opal42_gradient._jsnum.js_round`, JavaScript's ``%``
  is ``fmod`` and ``Math.cbrt`` is :func:`~opal42_gradient._jsnum.js_cbrt`;
* numbers are formatted in CSS with :func:`~opal42_gradient._jsnum.js_number_str`.
"""

from __future__ import annotations

import json
import math
import re
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass, replace
from typing import Any, Final, Literal

from ._jsnum import clamp, js_fmod, js_number_str, js_round
from ._tolerance import approx_eq, arg_best, hue_arc_ends
from .colorspace import (
    RGB,
    Lch,
    Oklab,
    hex_to_oklch,
    hex_to_rgb,
    lch_to_oklab,
    oklab_delta_e,
    oklab_to_lch,
    oklab_to_rgb,
    rgb_to_hex,
    rgb_to_oklab,
)
from .scoring_model import (
    BOUNDARY_EPSILON,
    V1_BOUNDARY_TABLE,
    V1_MODEL,
    Dimension,
    ScoreMeasurements,
    Severity,
    Tier,
)

__all__ = [
    "Finding",
    "GradientDirection",
    "GradientScore",
    "MAX_DIRECTIONS",
    "RefineResult",
    "ScoreDetails",
    "Stop",
    "boundary_hits",
    "build_gradient_css",
    "build_multi_gradient_style",
    "color_at_position",
    "interpolate_gradient",
    "is_valid_stop_color",
    "refine_gradient",
    "score_gradient",
    "spread_direction_angles",
    "suggest_gradient",
    "unscorable_reason",
]

# ── Types ────────────────────────────────────────────────────────────────────


@dataclass(frozen=True)
class Stop:
    """One colour stop: an opaque ``#rrggbb`` colour at a position 0..100 (percent)."""

    color: str
    position: float
    id: int | str | None = None


StopLike = Stop | Mapping[str, Any] | tuple[str, float]
"""What the public functions accept: a :class:`Stop`, a mapping with ``color`` and
``position`` (and optionally ``id``), or a ``(color, position)`` pair."""


def as_stop(stop: object) -> Stop:
    """Coerce a :data:`StopLike`.  Anything unusable becomes a ``Stop`` that is
    reported as out-of-domain by :func:`unscorable_reason` (never an exception)."""
    if isinstance(stop, Stop):
        return stop
    if isinstance(stop, Mapping):
        return Stop(stop.get("color"), stop.get("position"), stop.get("id"))  # type: ignore[arg-type]
    if isinstance(stop, tuple) and len(stop) == 2:
        return Stop(stop[0], stop[1])
    return Stop(None, None)  # type: ignore[arg-type]


@dataclass(frozen=True)
class Finding:
    """One deduction, coded and located.

    Every point :func:`score_gradient` takes off is represented by exactly one
    finding.  ``stops`` index the POSITION-SORTED stops; ``segment`` is
    ``(start, end)`` in positions 0..100.
    """

    code: str
    severity: Severity
    dimension: Dimension
    #: The rule's nominal penalty (before any per-dimension clamp at 0).
    points_lost: int
    message: str
    stops: tuple[int, ...] | None = None
    segment: tuple[float, float] | None = None


@dataclass(frozen=True)
class ScoreDetails:
    lightness: int
    hue: int
    chroma: int
    #: The "rhythm" dimension of the findings.
    spacing: int
    #: What the thresholds were compared against (``None`` when unscorable).
    measurements: ScoreMeasurements | None = None


@dataclass(frozen=True)
class GradientScore:
    #: ``"unscorable"`` when the input is outside the v1 domain.
    status: Literal["ok", "unscorable"]
    score: int
    #: ``[f.message for f in findings]``, kept for display.
    issues: tuple[str, ...]
    details: ScoreDetails
    #: Coded, located deductions, in rule order.  Per dimension ``d`` with
    #: budget ``W_d``: ``W_d - details[d] == min(W_d, sum of points_lost in d)``.
    findings: tuple[Finding, ...]
    #: Why the input is unscorable.
    reason: str | None = None


@dataclass(frozen=True)
class RefineResult:
    #: The refined stops, or (when declined) the input, position-sorted.
    stops: list[Stop]
    #: False when refine declined and ``stops`` is the input unchanged.
    refined: bool
    declined: Literal["unscorable", "single-position", "would-lower-score"] | None
    #: Score of the input and of ``stops`` (0 / 0 when unscorable).
    before: int
    after: int


# ── Domain ───────────────────────────────────────────────────────────────────

_HEX_COLOR: Final = re.compile(r"#[0-9a-fA-F]{6}")  # used with fullmatch: JS `$` has no "before a final \n" case


def is_valid_stop_color(color: object) -> bool:
    """True for an opaque ``#rrggbb`` colour (either case): the only colour v1 accepts."""
    return isinstance(color, str) and _HEX_COLOR.fullmatch(color) is not None


def _is_finite_number(value: object) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def _is_renderable(stop: Stop) -> bool:
    """A stop the CSS / interpolation helpers can use: valid colour and a finite position."""
    return is_valid_stop_color(stop.color) and _is_finite_number(stop.position)


def _js_json(value: object) -> str:
    """``JSON.stringify(value)`` for the values that can appear in a reason."""
    if value is None:
        return "null"
    try:
        return json.dumps(value, ensure_ascii=False)
    except (TypeError, ValueError):
        return "undefined"


def unscorable_reason(ticks: Sequence[StopLike]) -> str | None:
    """Why ``ticks`` is outside the v1 input domain, or ``None`` when it is scorable.

    Domain: at least two stops, each an opaque ``#rrggbb`` colour at a finite
    position in 0..100.  The reason names the first offending stop by its index
    in the INPUT sequence.
    """
    d = V1_MODEL.domain
    if isinstance(ticks, (str, bytes)) or not isinstance(ticks, Sequence) or len(ticks) < d.min_stops:
        return f"needs at least {d.min_stops} stops"
    for i, raw in enumerate(ticks):
        t = as_stop(raw)
        if not is_valid_stop_color(t.color):
            shown = "undefined" if raw is None else _js_json(t.color)
            return f"stop {i}: colour {shown} is not an opaque #rrggbb hex colour"
        if not _is_finite_number(t.position):
            return f"stop {i}: position is not a finite number"
        if t.position < d.min_position or t.position > d.max_position:
            return f"stop {i}: position {js_number_str(t.position)} is outside {d.min_position}..{d.max_position}"
    return None


def _sort_by_position(ticks: Iterable[Stop]) -> list[Stop]:
    """Stable sort by position (input order breaks ties, as CSS paints them)."""
    return sorted(ticks, key=lambda t: t.position)


# ── Small helpers (explicit loops: see the module docstring) ─────────────────


def _interior_extrema(values: Sequence[float]) -> list[int]:
    out: list[int] = []
    for i in range(1, len(values) - 1):
        prev, cur, nxt = values[i - 1], values[i], values[i + 1]
        if (cur < prev and cur < nxt) or (cur > prev and cur > nxt):
            out.append(i)
    return out


def _most_deviant(values: Sequence[float], mean: float) -> int:
    """The value deviating most from ``mean``; ties within EPS to the lowest index (D8)."""
    return arg_best([abs(v - mean) for v in values], "max")


def _total(values: Iterable[float]) -> float:
    """``values.reduce((a, v) => a + v, 0)``: plain left-to-right addition."""
    acc: float = 0
    for v in values:
        acc = acc + v
    return acc


def _population_cv(values: Sequence[float], mean: float) -> float:
    """sqrt(population variance) / mean, summed left to right like the reference."""
    acc: float = 0
    for v in values:
        diff = v - mean
        acc = acc + diff * diff
    return math.sqrt(acc / len(values)) / mean


# ── Boundary helper ──────────────────────────────────────────────────────────


def boundary_hits(
    measurements: ScoreMeasurements,
    eps: float = BOUNDARY_EPSILON,
    only: Sequence[str] | None = None,
) -> list[str]:
    """Measurements lying within ``eps * max(1, |t|)`` of one of their thresholds ``t``.

    Returned as ``"measurement@threshold"`` strings using the spec's camelCase
    measurement names (deduplicated, table order), exactly like the reference's
    ``boundaryHits``.  A case with any hit is a *boundary* case: a port is
    required to match its intermediate measurements (with tolerance) but not
    necessarily its integer score.  ``only`` restricts the check to a subset of
    measurement names.
    """
    hits: list[str] = []
    for entry in V1_BOUNDARY_TABLE:
        if only is not None and entry.name not in only:
            continue
        raw = getattr(measurements, entry.field_name)
        if raw is None:
            continue
        values = list(raw) if isinstance(raw, (tuple, list)) else [raw]
        for t in entry.thresholds:
            tol = eps * max(1, abs(t))
            if any(abs((abs(v) if entry.absolute else v) - t) < tol for v in values):
                hits.append(f"{entry.name}@{js_number_str(t)}")
    return hits


# ── Scoring ──────────────────────────────────────────────────────────────────


def _unscorable(reason: str) -> GradientScore:
    return GradientScore(
        status="unscorable",
        score=0,
        issues=(),
        details=ScoreDetails(0, 0, 0, 0, None),
        findings=(),
        reason=reason,
    )


def score_gradient(ticks: Sequence[StopLike]) -> GradientScore:
    """Score a gradient 0..100 under scoring model v1 (``spec/scoring-v1.md``).

    The stops are stable-sorted by position first, so the result does not
    depend on the order of the input (except among stops sharing a position,
    whose input order is what CSS paints and is therefore kept).  Input outside
    the v1 domain returns ``status="unscorable"`` with a reason and score 0.
    """
    reason = unscorable_reason(ticks)
    if reason is not None:
        return _unscorable(reason)

    M = V1_MODEL
    sorted_stops = _sort_by_position(as_stop(t) for t in ticks)
    n = len(sorted_stops)
    positions = [t.position for t in sorted_stops]
    rgbs = [hex_to_rgb(t.color) for t in sorted_stops]
    oklabs = [rgb_to_oklab(rgb) for rgb in rgbs]
    lchs = [oklab_to_lch(lab) for lab in oklabs]
    everything = list(range(n))

    def seg(i: int) -> tuple[Sequence[int], tuple[float, float]]:
        return (i, i + 1), (positions[i], positions[i + 1])

    findings: list[Finding] = []

    def add(
        code: str,
        dimension: Dimension,
        tier: Tier,
        stops: Sequence[int] | None = None,
        segment: tuple[float, float] | None = None,
        message: str | None = None,
        penalty: int | None = None,
    ) -> int:
        points = tier.penalty if penalty is None else penalty
        findings.append(
            Finding(
                code=code,
                severity=tier.severity,
                dimension=dimension,
                points_lost=points,
                message=tier.message if message is None else message,
                stops=None if stops is None else tuple(sorted(set(stops))),
                segment=None if segment is None else (segment[0], segment[1]),
            )
        )
        return points

    # Per-segment quantities (position-neighbours).
    segment_gaps = [positions[i + 1] - positions[i] for i in range(n - 1)]
    segment_delta_e = [oklab_delta_e(oklabs[i], oklabs[i + 1]) for i in range(n - 1)]

    # ── 1. Lightness flow ────────────────────────────────────────────────────
    ML = M.lightness
    lightness_score: int = M.weights.lightness

    # 1a. Monotonicity: interior local extrema of OKLab L.
    reversals = _interior_extrema([c.L for c in lchs])
    dips = len(reversals)
    if dips > 0:
        message = ML.reversal.message_template.replace("{count}", str(dips)).replace(
            "{plural}", "s" if dips > 1 else ""
        )
        lightness_score -= add(
            ML.reversal.code,
            "lightness",
            Tier(dips * ML.reversal.penalty_per_reversal, ML.reversal.severity, message),
            stops=reversals,
        )

    # 1a'. Helmholtz-Kohlrausch: L_apparent ~ L + k C.
    hk_reversals = _interior_extrema([c.L + ML.perceived_reversal.chroma_weight * c.C for c in lchs])
    if dips == 0 and hk_reversals:
        lightness_score -= add(
            ML.perceived_reversal.code, "lightness", ML.perceived_reversal.tier, stops=hk_reversals
        )

    # 1b. Perceptual contrast: max OKLab delta E between any two stops.
    max_delta_e: float = 0
    for i in range(n):
        for j in range(i + 1, n):
            max_delta_e = max(max_delta_e, oklab_delta_e(oklabs[i], oklabs[j]))
    whole_segment = (positions[0], positions[n - 1])
    if max_delta_e < ML.contrast.invisible_below:
        lightness_score -= add(ML.contrast.code, "lightness", ML.contrast.invisible, everything, whole_segment)
    elif max_delta_e < ML.contrast.low_below:
        lightness_score -= add(ML.contrast.code, "lightness", ML.contrast.low, everything, whole_segment)

    # 1c. Transition abruptness: first neighbour pair with a big delta E in a small gap.
    max_close_jump: float = 0
    abrupt_at = -1
    for i in range(n - 1):
        gap = segment_gaps[i]
        if gap > 0 and gap <= ML.abrupt_jump.max_gap:
            max_close_jump = max(max_close_jump, segment_delta_e[i])
            if abrupt_at < 0 and segment_delta_e[i] > ML.abrupt_jump.delta_e_above:
                abrupt_at = i
    if abrupt_at >= 0:
        stops_, segment_ = seg(abrupt_at)
        lightness_score -= add(ML.abrupt_jump.code, "lightness", ML.abrupt_jump.tier, stops_, segment_)

    # 1d. Velocity uniformity: CV of delta E per position-% over segments.
    velocity_cv: float | None = None
    if n >= ML.velocity.min_stops:
        velocities: list[float] = []
        velocity_segments: list[int] = []
        for i in range(n - 1):
            pos_gap = segment_gaps[i]
            if pos_gap > 0:
                velocities.append(segment_delta_e[i] / pos_gap)
                velocity_segments.append(i)
        if len(velocities) >= ML.velocity.min_segments:
            avg_v = _total(velocities) / len(velocities)
            if avg_v > 0:
                velocity_cv = _population_cv(velocities, avg_v)
                stops_, segment_ = seg(velocity_segments[_most_deviant(velocities, avg_v)])
                if velocity_cv > ML.velocity.strong_above:
                    lightness_score -= add(ML.velocity.code, "lightness", ML.velocity.strong, stops_, segment_)
                elif velocity_cv > ML.velocity.mild_above:
                    lightness_score -= add(ML.velocity.code, "lightness", ML.velocity.mild, stops_, segment_)

    # ── 2. Hue harmony ───────────────────────────────────────────────────────
    MH = M.hue
    chromatic = [i for i in everything if lchs[i].C > MH.chromatic_above]
    hue_score: int = M.weights.hue
    enclosing_arc: float | None = None
    if len(chromatic) >= 2:
        by_hue = sorted(((lchs[i].h, i) for i in chromatic), key=lambda p: p[0])
        last = len(by_hue) - 1
        max_gap = by_hue[0][0] + 360 - by_hue[last][0]
        for k in range(1, len(by_hue)):
            gap = by_hue[k][0] - by_hue[k - 1][0]
            if gap > max_gap:
                max_gap = gap
        enclosing_arc = 360 - max_gap
        # The arc runs from the hue after the largest gap round to the hue before it;
        # which of several equal-hue stops is named is decided with ties (D8).
        arc_ends = hue_arc_ends([i for _, i in by_hue], [lch.h for lch in lchs])
        if enclosing_arc > MH.arc.clash_above:
            hue_score -= add(MH.arc.wide_code, "hue", MH.arc.clash, arc_ends)
        elif enclosing_arc > MH.arc.wide_above:
            hue_score -= add(MH.arc.wide_code, "hue", MH.arc.wide, arc_ends)
        elif enclosing_arc < MH.arc.narrow_below:
            hue_score -= add(MH.arc.narrow_code, "hue", MH.arc.narrow, arc_ends)

    # 2b. Hue direction consistency over chromatic stops in position order.
    hue_steps: list[float] = []
    if len(chromatic) >= 2:
        for k in range(len(chromatic) - 1):
            delta = lchs[chromatic[k + 1]].h - lchs[chromatic[k]].h
            delta = js_fmod(js_fmod(delta + 180, 360) + 360, 360) - 180  # shortest arc
            hue_steps.append(delta)
    if len(chromatic) >= MH.direction.min_chromatic_stops:
        cw_count = ccw_count = 0
        turns: list[int] = []
        last_sign = 0
        for k, delta in enumerate(hue_steps):
            sign = 1 if delta > MH.direction.min_step else -1 if delta < -MH.direction.min_step else 0
            if sign > 0:
                cw_count += 1
            elif sign < 0:
                ccw_count += 1
            if sign != 0:
                # The stop where the new direction starts.
                if last_sign != 0 and sign != last_sign:
                    turns.append(chromatic[k])
                last_sign = sign
        if cw_count > 0 and ccw_count > 0:
            hue_score -= add(MH.direction.code, "hue", MH.direction.tier, turns)

    # ── 3. Saturation balance ────────────────────────────────────────────────
    MC = M.chroma
    chromas = [c.C for c in lchs]
    max_c = max(chromas)
    min_c = min(chromas)
    chroma_range = max_c - min_c
    chroma_score: int = M.weights.chroma

    # 3a. Stop-level chroma consistency.
    range_where = [arg_best(chromas, "max"), arg_best(chromas, "min")]  # ties within EPS: lowest index (D8)
    if chroma_range > MC.range.spike_above:
        chroma_score -= add(MC.range.code, "chroma", MC.range.spike, range_where)
    elif chroma_range > MC.range.uneven_above:
        chroma_score -= add(MC.range.code, "chroma", MC.range.uneven, range_where)

    # 3b. Chroma coherence: a near-achromatic stop among vivid chromatic stops.
    coherence_ratio: float | None = None
    if n >= MC.coherence.min_stops:
        achromatic = [i for i in everything if chromas[i] < MC.coherence.achromatic_below]
        vivid = [i for i in everything if chromas[i] >= MC.coherence.vivid_at_least]
        if achromatic and vivid:
            max_chromatic = max(chromas[i] for i in vivid)
            min_achromatic = min(chromas[i] for i in achromatic)
            ratio = min_achromatic / max_chromatic  # 0 = total mismatch
            coherence_ratio = ratio
            if ratio < MC.coherence.dead_zone_below:
                chroma_score -= add(MC.coherence.code, "chroma", MC.coherence.dead_zone, achromatic)
            elif ratio < MC.coherence.gap_below:
                chroma_score -= add(MC.coherence.code, "chroma", MC.coherence.gap, achromatic)

    # 3c. Midpoint desaturation at the 8-bit sRGB midpoint of each segment.
    #     Math.round((a + b) / 2) is a half-up rounding; Python's round() would go to even.
    worst_dip: float = 0
    worst_dip_at = -1
    segment_dips: list[float] = []
    segment_endpoint_chroma: list[float] = []
    for i in range(n - 1):
        c1, c2 = rgbs[i], rgbs[i + 1]
        mid = RGB(
            js_round((c1.r + c2.r) / 2),
            js_round((c1.g + c2.g) / 2),
            js_round((c1.b + c2.b) / 2),
        )
        mid_lch = oklab_to_lch(rgb_to_oklab(mid))
        avg_endpoint_chroma = (lchs[i].C + lchs[i + 1].C) / 2
        segment_endpoint_chroma.append(avg_endpoint_chroma)
        segment_dips.append(math.nan)
        if avg_endpoint_chroma > MC.midpoint.endpoint_chroma_above:
            dip = 1 - mid_lch.C / avg_endpoint_chroma
            segment_dips[i] = dip
            if dip > worst_dip:
                worst_dip = dip
    if worst_dip > 0:
        worst_dip_at = arg_best(segment_dips, "max")  # ties within EPS: first segment (D8)
    if worst_dip > MC.midpoint.muddy_above:
        stops_, segment_ = seg(worst_dip_at)
        chroma_score -= add(MC.midpoint.code, "chroma", MC.midpoint.muddy, stops_, segment_)
    elif worst_dip > MC.midpoint.slight_above:
        stops_, segment_ = seg(worst_dip_at)
        chroma_score -= add(MC.midpoint.code, "chroma", MC.midpoint.slight, stops_, segment_)

    # 3d. Banding risk: few 8-bit levels stretched over a long span (first hit only).
    segment_rgb_steps = [
        int(max(abs(rgbs[i].r - rgbs[i + 1].r), abs(rgbs[i].g - rgbs[i + 1].g), abs(rgbs[i].b - rgbs[i + 1].b)))
        for i in range(n - 1)
    ]
    for i in range(n - 1):
        steps, span_ = segment_rgb_steps[i], segment_gaps[i]
        if steps < MC.banding.strong_steps_below and span_ > MC.banding.strong_span_above:
            stops_, segment_ = seg(i)
            chroma_score -= add(MC.banding.code, "chroma", MC.banding.strong, stops_, segment_)
            break
        if steps < MC.banding.subtle_steps_below and span_ > MC.banding.subtle_span_above:
            stops_, segment_ = seg(i)
            chroma_score -= add(MC.banding.code, "chroma", MC.banding.subtle, stops_, segment_)
            break

    # ── 4. Stop rhythm (ScoreDetails.spacing) ────────────────────────────────
    MR = M.rhythm
    first_pos, last_pos = positions[0], positions[n - 1]
    spacing_score: int = M.weights.rhythm
    ends = [0, n - 1]

    # 4a. Edge coverage.
    edge_gap = first_pos + (100 - last_pos)
    if edge_gap > MR.edge.bunched_above:
        spacing_score -= add(MR.edge.code, "rhythm", MR.edge.bunched, ends)
    elif edge_gap > MR.edge.short_above:
        spacing_score -= add(MR.edge.code, "rhythm", MR.edge.short, ends)
    elif edge_gap > MR.edge.slight_above:
        spacing_score -= add(MR.edge.code, "rhythm", MR.edge.slight, ends)

    # 4b. Transition span.
    span = last_pos - first_pos
    span_segment = (first_pos, last_pos)
    if span < MR.span.squeezed_below:
        spacing_score -= add(MR.span.code, "rhythm", MR.span.squeezed, ends, span_segment)
    elif span < MR.span.narrow_below:
        spacing_score -= add(MR.span.code, "rhythm", MR.span.narrow, ends, span_segment)

    # 4c. Rhythm: gap evenness via coefficient of variation.
    gap_cv: float | None = None
    if n >= MR.gaps.min_stops:
        avg_gap = _total(segment_gaps) / len(segment_gaps)
        if avg_gap > 0:
            gap_cv = _population_cv(segment_gaps, avg_gap)
            stops_, segment_ = seg(_most_deviant(segment_gaps, avg_gap))
            if gap_cv > MR.gaps.clustered_above:
                spacing_score -= add(MR.gaps.code, "rhythm", MR.gaps.clustered, stops_, segment_)
            elif gap_cv > MR.gaps.uneven_above:
                spacing_score -= add(MR.gaps.code, "rhythm", MR.gaps.uneven, stops_, segment_)

    measurements = ScoreMeasurements(
        lightness_reversals=dips,
        perceived_reversals=len(hk_reversals),
        max_delta_e=max_delta_e,
        max_close_jump_delta_e=max_close_jump,
        velocity_cv=velocity_cv,
        stop_chroma=tuple(chromas),
        enclosing_arc=enclosing_arc,
        hue_steps=tuple(hue_steps),
        chroma_range=chroma_range,
        coherence_ratio=coherence_ratio,
        segment_endpoint_chroma=tuple(segment_endpoint_chroma),
        worst_dip=worst_dip,
        segment_rgb_steps=tuple(segment_rgb_steps),
        segment_gaps=tuple(segment_gaps),
        edge_gap=edge_gap,
        span=span,
        gap_cv=gap_cv,
    )
    details = ScoreDetails(
        lightness=max(0, lightness_score),
        hue=max(0, hue_score),
        chroma=max(0, chroma_score),
        spacing=max(0, spacing_score),
        measurements=measurements,
    )
    return GradientScore(
        status="ok",
        score=details.lightness + details.hue + details.chroma + details.spacing,
        issues=tuple(f.message for f in findings),
        details=details,
        findings=tuple(findings),
    )


# ── Refine ("suggest") ───────────────────────────────────────────────────────


def refine_gradient(ticks: Sequence[StopLike]) -> RefineResult:
    """Refine a gradient under model v1 and say whether it did.

    Guarantees (PLAN section 3.5):

    1. never lowers the score: if the refinement would score below the input
       the input is returned unchanged (position-sorted) with
       ``declined="would-lower-score"``;
    2. keeps achromatic stops (OKLCH C <= ``refine.achromatic_at_most``)
       achromatic: they keep their chroma and hue, only L is smoothed;
    3. keeps hard stops: position-neighbours at most ``refine.hard_stop_gap``
       apart move together as one group and keep their offsets; if every stop
       is in one group refine declines;
    4. is invariant under permutations of the input (it sorts first).

    Input outside the v1 domain is returned as is (``declined="unscorable"``).
    """
    if unscorable_reason(ticks) is not None:
        return RefineResult([as_stop(t) for t in ticks] if isinstance(ticks, Sequence) else [], False, "unscorable", 0, 0)
    R = V1_MODEL.refine
    by_pos = _sort_by_position(as_stop(t) for t in ticks)
    n = len(by_pos)
    before = score_gradient(ticks).score

    def unchanged(declined: Literal["unscorable", "single-position", "would-lower-score"]) -> RefineResult:
        return RefineResult(
            [Stop(t.color, t.position, t.id) for t in by_pos], False, declined, before, before
        )

    # Hard-stop groups: runs of position-neighbours at most hard_stop_gap apart.
    group = [0]
    for i in range(1, n):
        same_group = by_pos[i].position - by_pos[i - 1].position <= R.hard_stop_gap
        group.append(group[i - 1] if same_group else group[i - 1] + 1)
    groups = group[n - 1] + 1
    if groups < 2:
        return unchanged("single-position")

    lchs: list[Lch] = [oklab_to_lch(rgb_to_oklab(hex_to_rgb(t.color))) for t in by_pos]
    achromatic = [c.C <= R.achromatic_at_most for c in lchs]

    # Step 1: smooth lightness monotonically along the existing direction.
    first_l, last_l = lchs[0].L, lchs[-1].L
    smoothed: list[Lch] = []
    for i, c in enumerate(lchs):
        t = i / (len(lchs) - 1)
        target_l = first_l + t * (last_l - first_l)
        smoothed.append(replace(c, L=c.L * R.lightness_keep + target_l * (1 - R.lightness_keep)))
    lchs = smoothed

    # Step 2: compress the hue arc of the chromatic stops to <= max_hue_arc around
    #   their circular mean (see spec/scoring-v1.md section 7 for the degenerate case).
    chromatic = [c for i, c in enumerate(lchs) if not achromatic[i]]
    if len(chromatic) >= 2:

        def to_rad(deg: float) -> float:
            return (deg * math.pi) / 180

        def to_deg(rad: float) -> float:
            return (rad * 180) / math.pi

        mean_x = _total(math.cos(to_rad(c.h)) for c in chromatic) / len(chromatic)
        mean_y = _total(math.sin(to_rad(c.h)) for c in chromatic) / len(chromatic)
        if math.sqrt(mean_x * mean_x + mean_y * mean_y) < R.degenerate_resultant_below:
            h1 = chromatic[0].h
            d = js_fmod(js_fmod(chromatic[-1].h - h1, 360) + 360, 360)
            # Exactly 180 degrees (within EPS, D8): towards increasing hue.
            mean_hue = js_fmod((h1 + d / 2 if d <= 180 or approx_eq(d, 180) else h1 - (360 - d) / 2) + 360, 360)
        else:
            mean_hue = js_fmod(to_deg(math.atan2(mean_y, mean_x)) + 360, 360)

        # Measure the enclosing arc.
        sorted_h = sorted(c.h for c in chromatic)
        max_gap = sorted_h[0] + 360 - sorted_h[-1]
        for i in range(1, len(sorted_h)):
            max_gap = max(max_gap, sorted_h[i] - sorted_h[i - 1])
        arc = 360 - max_gap

        if arc > R.max_hue_arc:
            scale = R.max_hue_arc / arc
            compressed: list[Lch] = []
            for i, c in enumerate(lchs):
                if achromatic[i]:
                    compressed.append(c)
                    continue
                delta = c.h - mean_hue  # signed shortest-path delta from the centre
                delta = js_fmod(js_fmod(delta + 180, 360) + 360, 360) - 180
                compressed.append(replace(c, h=js_fmod((mean_hue + delta * scale) + 360, 360)))
            lchs = compressed

    # Step 3: smooth chroma of the chromatic stops (gentle envelope around their mean).
    if chromatic:
        avg_c = _total(c.C for c in chromatic) / len(chromatic)
        shaped: list[Lch] = []
        for i, c in enumerate(lchs):
            if achromatic[i]:
                shaped.append(c)
                continue
            t = i / (len(lchs) - 1)
            envelope = 1 + R.chroma_envelope * math.sin(math.pi * t)
            shaped.append(replace(c, C=min(R.max_chroma, avg_c * envelope)))
        lchs = shaped

    # Step 4: redistribute evenly: one slot per hard-stop group; members keep
    #   their offset from the group's first stop, the last group ends at 100.
    group_start: dict[int, float] = {}
    group_width: dict[int, float] = {}
    for i in range(n):
        g = group[i]
        if g not in group_start:
            group_start[g] = by_pos[i].position
        group_width[g] = by_pos[i].position - group_start[g]
    new_positions: list[float] = []
    for i in range(n):
        g = group[i]
        anchor = 100 - group_width[g] if g == groups - 1 and groups > 1 else js_round((g / (groups - 1)) * 100)
        p = anchor + (by_pos[i].position - group_start[g])
        new_positions.append(max(new_positions[i - 1], p) if i > 0 else p)

    stops: list[Stop] = []
    for i, lch in enumerate(lchs):
        color = rgb_to_hex(oklab_to_rgb(lch_to_oklab(lch)))
        # 8-bit rounding must not push an achromatic stop over the line.
        if achromatic[i] and hex_to_oklch(color).C > R.achromatic_at_most:
            color = rgb_to_hex(oklab_to_rgb(lch_to_oklab(replace(lch, C=0))))
        stops.append(Stop(color, new_positions[i], by_pos[i].id))

    after = score_gradient(stops).score
    if after < before:
        return unchanged("would-lower-score")
    return RefineResult(stops, True, None, before, after)


def suggest_gradient(ticks: Sequence[StopLike]) -> list[Stop]:
    """One-click refinement (see :func:`refine_gradient` for the guarantees).

    Returns the input (as :class:`Stop` objects) when it has fewer than two
    stops or is outside the v1 domain.
    """
    if len(ticks) < 2:
        return [as_stop(t) for t in ticks]
    return refine_gradient(ticks).stops


# ── CSS builders ─────────────────────────────────────────────────────────────


def build_gradient_css(ticks: Sequence[StopLike], angle: float) -> str:
    """``linear-gradient(...)`` for the stops, sorted by position.

    Stops with an invalid colour or a non-finite position are skipped (never
    ``NaN`` in CSS); with no usable stop the result is the neutral fallback
    ``#ccc``.
    """
    usable = [t for t in (as_stop(t) for t in ticks) if _is_renderable(t)]
    if not usable:
        return "#ccc"
    stops = ", ".join(f"{t.color} {js_number_str(t.position)}%" for t in _sort_by_position(usable))
    return f"linear-gradient({js_number_str(angle)}deg, {stops})"


#: Hard ceiling on simultaneous gradient directions.
MAX_DIRECTIONS: Final = 7


@dataclass(frozen=True)
class GradientDirection:
    id: int
    #: CSS angle in degrees: 0 = to top, increasing clockwise.
    angle: float
    #: Relative influence of this direction, 1..100.
    weight: float
    enabled: bool = True


GradientBlendMode = Literal[
    "normal", "screen", "multiply", "overlay", "soft-light", "hard-light", "difference", "lighten", "darken"
]


@dataclass(frozen=True)
class GradientStyle:
    background: str
    background_blend_mode: str


def _rgba_string(hex_color: str, alpha: float) -> str:
    rgb = hex_to_rgb(hex_color)
    shown = js_round(clamp(alpha, 0, 1) * 1000) / 1000
    return f"rgba({js_number_str(rgb.r)}, {js_number_str(rgb.g)}, {js_number_str(rgb.b)}, {js_number_str(shown)})"


def build_multi_gradient_style(
    ticks: Sequence[StopLike],
    directions: Sequence[GradientDirection],
    blend: GradientBlendMode = "normal",
) -> GradientStyle:
    """Compose the stop list into up to ``MAX_DIRECTIONS`` stacked ``linear-gradient`` layers.

    With ``blend="normal"`` the layers are alpha-composited so the result is the
    exact weighted average of every direction (``alpha_k = w_k / (w_1 + ... + w_k)``).
    Other blend modes hand the layers to ``background-blend-mode`` with alpha
    scaled against the heaviest direction.  CSS lists layers top-first, so the
    emitted lists are reversed relative to paint order.
    """
    usable = [t for t in (as_stop(t) for t in ticks) if _is_renderable(t)]
    if not usable:
        return GradientStyle("#ccc", "normal")

    active = [d for d in directions if d.enabled and d.weight > 0]
    ordered = _sort_by_position(usable)
    if not active:
        return GradientStyle(ordered[0].color, "normal")  # a flat wash of the first stop

    max_weight = max(d.weight for d in active)
    cumulative: float = 0
    layers: list[str] = []
    for d in active:
        cumulative = cumulative + d.weight
        alpha = d.weight / cumulative if blend == "normal" else d.weight / max_weight
        stops = ", ".join(f"{_rgba_string(t.color, alpha)} {js_number_str(t.position)}%" for t in ordered)
        layers.append(f"linear-gradient({js_number_str(d.angle)}deg, {stops})")

    # The bottom layer has nothing beneath it to blend with, so it stays normal.
    modes = ["normal" if i == 0 else blend for i in range(len(active))]
    return GradientStyle(", ".join(reversed(layers)), ", ".join(reversed(modes)))


def spread_direction_angles(n: int, start: float = 135) -> list[int]:
    """``n`` directions spread evenly around the circle, starting at ``start``."""
    count = max(1, min(MAX_DIRECTIONS, n))
    return [js_round(js_fmod(start + (i * 360) / count, 360)) for i in range(count)]


# ── Interpolation ────────────────────────────────────────────────────────────


@dataclass(frozen=True)
class _Sample:
    pos: float
    color: str
    lab: Oklab


def _sample_sorted(stops: Sequence[_Sample], x: float) -> str:
    """The shared bracket search: end colours verbatim outside the stops, OKLab in between."""
    first, last = stops[0], stops[-1]
    if not (x > first.pos):  # also NaN
        return first.color
    if x >= last.pos:
        return last.color

    lo = 0
    for i in range(len(stops) - 1):
        if stops[i + 1].pos >= x:
            lo = i
            break
    a, b = stops[lo], stops[lo + 1]
    span = b.pos - a.pos
    frac = 0 if span == 0 else (x - a.pos) / span
    return rgb_to_hex(
        oklab_to_rgb(
            Oklab(
                a.lab.L + (b.lab.L - a.lab.L) * frac,
                a.lab.a + (b.lab.a - a.lab.a) * frac,
                a.lab.b + (b.lab.b - a.lab.b) * frac,
            )
        )
    )


def _sample_stops(ticks: Iterable[Stop], scale: float) -> list[_Sample]:
    return [
        _Sample(t.position / scale, t.color, rgb_to_oklab(hex_to_rgb(t.color)))
        for t in _sort_by_position(t for t in ticks if _is_renderable(t))
    ]


def interpolate_gradient(ticks: Sequence[StopLike], n: int) -> list[str]:
    """``n`` evenly spaced colours of a gradient, interpolated in OKLab.

    Samples before the first stop take its colour and samples after the last
    take the last one's (clamped, like CSS); invalid stops are skipped.
    """
    valid = [t for t in (as_stop(t) for t in ticks) if _is_renderable(t)]
    if not valid:
        return []
    if len(valid) == 1 or n <= 1:
        return [valid[0].color]
    stops = _sample_stops(valid, 100)
    return [_sample_sorted(stops, i / (n - 1)) for i in range(n)]


def color_at_position(ticks: Sequence[StopLike], position: float) -> str:
    """The colour a gradient shows at ``position`` (0..100), interpolated in OKLab.

    Positions outside the stop range take the nearest end stop's colour.
    Invalid stops are skipped; with none left the result is ``#000000``.
    """
    stops = _sample_stops((as_stop(t) for t in ticks), 1)
    if not stops:
        return "#000000"
    return _sample_sorted(stops, position)

