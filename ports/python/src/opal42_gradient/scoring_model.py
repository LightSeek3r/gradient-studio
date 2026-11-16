"""Scoring model v1: every threshold, weight, penalty, severity and message.

A line-for-line port of ``V1_MODEL`` in ``packages/core/src/scoring-model-v1.ts``
(the reference).  Names are the reference's names in ``snake_case``
(``penaltyPerReversal`` -> ``penalty_per_reversal``); the conformance suite
checks every ``V1_MODEL.<path> = <value>`` line of ``spec/scoring-v1.md``
against this table by that mechanical rule.

The table is a tree of frozen dataclasses: nothing here can be mutated.
Changing any value changes the v1 contract and fails the conformance vectors;
v1 is frozen and improvements belong in a v2 model.

Comparison direction is part of each name: ``..._above`` means "fires when the
measurement is strictly greater", ``..._below`` strictly less, ``..._at_most``
``<=``, ``..._at_least`` ``>=``.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Final, Literal

Severity = Literal["info", "warning", "error"]
Dimension = Literal["lightness", "hue", "chroma", "rhythm"]


@dataclass(frozen=True)
class Tier:
    """One penalty level of a rule: the points it costs and the message it emits."""

    penalty: int
    severity: Severity
    message: str


@dataclass(frozen=True)
class Domain:
    min_stops: int = 2
    #: Opaque ``#rrggbb``, case-insensitive (matched with ``fullmatch``).
    color_pattern: str = "^#[0-9a-fA-F]{6}$"
    min_position: int = 0
    max_position: int = 100


@dataclass(frozen=True)
class Weights:
    lightness: int = 30
    hue: int = 30
    chroma: int = 20
    rhythm: int = 20


# ── Lightness ────────────────────────────────────────────────────────────────


@dataclass(frozen=True)
class Reversal:
    code: str = "lightness/reversal"
    penalty_per_reversal: int = 12
    severity: Severity = "error"
    #: ``{count}`` = number of reversals, ``{plural}`` = "s" when count > 1.
    message_template: str = "Lightness fluctuates ({count} reversal{plural}) — creates visual noise"


@dataclass(frozen=True)
class PerceivedReversal:
    code: str = "lightness/perceived-reversal"
    chroma_weight: float = 0.25
    tier: Tier = Tier(
        6, "warning", "Saturated stops create perceived brightness reversals (Helmholtz–Kohlrausch effect)"
    )


@dataclass(frozen=True)
class Contrast:
    code: str = "lightness/low-contrast"
    invisible_below: float = 0.02
    invisible: Tier = Tier(15, "error", "Stops are nearly identical — gradient is invisible")
    low_below: float = 0.05
    low: Tier = Tier(8, "warning", "Very low contrast between stops — gradient barely visible")


@dataclass(frozen=True)
class AbruptJump:
    code: str = "lightness/abrupt-jump"
    #: The gap must be > 0 and <= max_gap (percent).
    max_gap: int = 10
    delta_e_above: float = 0.15
    tier: Tier = Tier(8, "warning", "Abrupt color jump between closely-spaced stops")


@dataclass(frozen=True)
class Velocity:
    code: str = "lightness/uneven-speed"
    min_stops: int = 3
    min_segments: int = 2
    strong_above: float = 0.8
    strong: Tier = Tier(8, "warning", "Uneven perceptual speed — some transitions race while others crawl")
    mild_above: float = 0.5
    mild: Tier = Tier(4, "info", "Slightly uneven transition speed across the gradient")


@dataclass(frozen=True)
class LightnessRules:
    reversal: Reversal = Reversal()
    perceived_reversal: PerceivedReversal = PerceivedReversal()
    contrast: Contrast = Contrast()
    abrupt_jump: AbruptJump = AbruptJump()
    velocity: Velocity = Velocity()


# ── Hue ──────────────────────────────────────────────────────────────────────


@dataclass(frozen=True)
class Arc:
    wide_code: str = "hue/wide-arc"
    clash_above: int = 180
    clash: Tier = Tier(20, "error", "Hue arc spans >180° — colors clash unexpectedly")
    wide_above: int = 120
    wide: Tier = Tier(8, "warning", "Wide hue arc (>120°) risks muddy midpoints")
    narrow_code: str = "hue/narrow-arc"
    narrow_below: int = 15
    narrow: Tier = Tier(5, "info", "Very narrow hue arc (<15°) — the gradient reads as a single hue")


@dataclass(frozen=True)
class Direction:
    code: str = "hue/direction-reversal"
    min_chromatic_stops: int = 3
    #: Steps with |delta h| <= this many degrees are ignored.
    min_step: int = 5
    tier: Tier = Tier(10, "warning", "Hue path reverses direction — risk of muddy in-between tones")


@dataclass(frozen=True)
class HueRules:
    #: Stops with OKLCH C above this take part in the hue rules.
    chromatic_above: float = 0.02
    arc: Arc = Arc()
    direction: Direction = Direction()


# ── Chroma ───────────────────────────────────────────────────────────────────


@dataclass(frozen=True)
class ChromaRange:
    code: str = "chroma/saturation-range"
    spike_above: float = 0.2
    spike: Tier = Tier(12, "error", "Saturation spikes dramatically — looks unintentional")
    uneven_above: float = 0.12
    uneven: Tier = Tier(5, "info", "Uneven saturation across stops")


@dataclass(frozen=True)
class Coherence:
    code: str = "chroma/dead-zone"
    min_stops: int = 3
    achromatic_below: float = 0.04
    vivid_at_least: float = 0.08
    dead_zone_below: float = 0.15
    dead_zone: Tier = Tier(8, "warning", "Grey/desaturated stop among vivid colors — creates a dead zone")
    gap_below: float = 0.3
    gap: Tier = Tier(4, "info", "Noticeable saturation gap between some stops")


@dataclass(frozen=True)
class Midpoint:
    code: str = "chroma/muddy-midpoint"
    #: Segments whose endpoints' mean C is at or below this are skipped.
    endpoint_chroma_above: float = 0.04
    muddy_above: float = 0.5
    muddy: Tier = Tier(10, "warning", "Colors produce a muddy/grey midpoint when blended")
    slight_above: float = 0.3
    slight: Tier = Tier(5, "info", "Slight desaturation in gradient midpoints")


@dataclass(frozen=True)
class Banding:
    code: str = "chroma/banding"
    strong_steps_below: int = 16
    strong_span_above: int = 25
    strong: Tier = Tier(6, "warning", "Low color resolution between stops — visible banding likely")
    subtle_steps_below: int = 8
    subtle_span_above: int = 10
    subtle: Tier = Tier(4, "info", "Subtle transition may produce banding artifacts on screen")


@dataclass(frozen=True)
class ChromaRules:
    range: ChromaRange = ChromaRange()
    coherence: Coherence = Coherence()
    midpoint: Midpoint = Midpoint()
    banding: Banding = Banding()


# ── Rhythm ───────────────────────────────────────────────────────────────────


@dataclass(frozen=True)
class Edge:
    code: str = "rhythm/edge-gap"
    bunched_above: int = 40
    bunched: Tier = Tier(12, "error", "Stops are bunched in the middle — large solid-color edges")
    short_above: int = 20
    short: Tier = Tier(6, "warning", "Stops don't reach the edges — visible solid-color zones")
    slight_above: int = 10
    slight: Tier = Tier(3, "info", "Stops fall slightly short of the edges — small solid-color zones")


@dataclass(frozen=True)
class Span:
    code: str = "rhythm/narrow-span"
    squeezed_below: int = 20
    squeezed: Tier = Tier(8, "warning", "Transition squeezed into a narrow band")
    narrow_below: int = 40
    narrow: Tier = Tier(4, "info", "Transition covers less than 40% of the gradient")


@dataclass(frozen=True)
class Gaps:
    code: str = "rhythm/uneven-gaps"
    min_stops: int = 3
    clustered_above: float = 0.5
    clustered: Tier = Tier(10, "warning", "Stop positions are unevenly clustered")
    uneven_above: float = 0.25
    uneven: Tier = Tier(4, "info", "Stop spacing is slightly uneven")


@dataclass(frozen=True)
class RhythmRules:
    edge: Edge = Edge()
    span: Span = Span()
    gaps: Gaps = Gaps()


# ── Refine ───────────────────────────────────────────────────────────────────


@dataclass(frozen=True)
class RefineRules:
    """``suggest_gradient`` ("refine")."""

    #: Step 1: L' = keep * L + (1 - keep) * linear ramp between the end stops' L.
    lightness_keep: float = 0.3
    #: Step 2: compress the chromatic hue arc to at most this many degrees.
    max_hue_arc: int = 80
    #: Stops with C at or below this are achromatic: their hue is undefined and their chroma is kept.
    achromatic_at_most: float = 0.02
    #: Below this mean resultant length the circular mean is ill-conditioned (opposed hues).
    degenerate_resultant_below: float = 0.05
    #: Step 3: C = min(max_chroma, mean chromatic C * (1 + envelope * sin(pi t))).
    chroma_envelope: float = 0.3
    max_chroma: float = 0.4
    #: Position-neighbours at most this far apart (percent) form a hard stop and move together.
    hard_stop_gap: int = 1


@dataclass(frozen=True)
class ScoringModelV1:
    version: str = "v1"
    domain: Domain = Domain()
    #: Points available per dimension; they sum to 100. ``rhythm`` is ``ScoreDetails.spacing``.
    weights: Weights = Weights()
    lightness: LightnessRules = LightnessRules()
    hue: HueRules = HueRules()
    chroma: ChromaRules = ChromaRules()
    rhythm: RhythmRules = RhythmRules()
    refine: RefineRules = RefineRules()


#: The v1 scoring and refinement model (immutable).
V1_MODEL: Final = ScoringModelV1()

#: Every finding code v1 can emit, with its dimension.
V1_FINDING_CODES: Final[dict[str, Dimension]] = {
    V1_MODEL.lightness.reversal.code: "lightness",
    V1_MODEL.lightness.perceived_reversal.code: "lightness",
    V1_MODEL.lightness.contrast.code: "lightness",
    V1_MODEL.lightness.abrupt_jump.code: "lightness",
    V1_MODEL.lightness.velocity.code: "lightness",
    V1_MODEL.hue.arc.wide_code: "hue",
    V1_MODEL.hue.arc.narrow_code: "hue",
    V1_MODEL.hue.direction.code: "hue",
    V1_MODEL.chroma.range.code: "chroma",
    V1_MODEL.chroma.coherence.code: "chroma",
    V1_MODEL.chroma.midpoint.code: "chroma",
    V1_MODEL.chroma.banding.code: "chroma",
    V1_MODEL.rhythm.edge.code: "rhythm",
    V1_MODEL.rhythm.span.code: "rhythm",
    V1_MODEL.rhythm.gaps.code: "rhythm",
}


# ── Measurements and the boundary table ──────────────────────────────────────


@dataclass(frozen=True)
class ScoreMeasurements:
    """The quantities v1 compares against its thresholds, on the position-sorted stops.

    Sequences are per stop (sorted order) or per segment (sorted neighbour
    pairs).  ``None`` means the rule was not applicable.
    """

    #: 1a: number of interior OKLAB-L extrema.
    lightness_reversals: int
    #: 1a': number of interior extrema of L + 0.25 C.
    perceived_reversals: int
    #: 1b: largest delta E between any two stops.
    max_delta_e: float
    #: 1c: largest delta E between position-neighbours whose gap is in (0, max_gap]; 0 if none.
    max_close_jump_delta_e: float
    #: 1d: CV of delta E / gap over segments with gap > 0.
    velocity_cv: float | None
    #: Per stop: OKLCH C.
    stop_chroma: tuple[float, ...]
    #: 2a: minimum enclosing arc of the chromatic hues (degrees).
    enclosing_arc: float | None
    #: 2b: signed shortest-arc steps between chromatic position-neighbours (degrees).
    hue_steps: tuple[float, ...]
    #: 3a: max C - min C.
    chroma_range: float
    #: 3b: min achromatic C / max vivid C.
    coherence_ratio: float | None
    #: 3c: per segment, mean of the endpoints' C.
    segment_endpoint_chroma: tuple[float, ...]
    #: 3c: largest relative chroma dip at an sRGB midpoint (0 if none applicable).
    worst_dip: float
    #: 3d: per segment, max |delta channel| in 8-bit sRGB (integers).
    segment_rgb_steps: tuple[int, ...]
    #: Per segment: position gap (percent).
    segment_gaps: tuple[float, ...]
    #: 4a: first + (100 - last).
    edge_gap: float
    #: 4b: last - first.
    span: float
    #: 4c: CV of the position gaps.
    gap_cv: float | None


@dataclass(frozen=True)
class BoundaryEntry:
    #: The measurement's name in the spec / vectors (camelCase).
    name: str
    #: The matching ``ScoreMeasurements`` field.
    field_name: str
    thresholds: tuple[float, ...]
    #: Compare |value| instead of value (signed hue steps).
    absolute: bool = False


_M = V1_MODEL

#: Which thresholds each measurement is compared against.  Counts and
#: ``segment_rgb_steps`` are integer-valued and computed exactly, so they are
#: not precision-sensitive and are not listed.
V1_BOUNDARY_TABLE: Final[tuple[BoundaryEntry, ...]] = (
    BoundaryEntry(
        "maxDeltaE", "max_delta_e", (_M.lightness.contrast.invisible_below, _M.lightness.contrast.low_below)
    ),
    BoundaryEntry(
        "maxCloseJumpDeltaE", "max_close_jump_delta_e", (_M.lightness.abrupt_jump.delta_e_above,)
    ),
    BoundaryEntry(
        "velocityCv", "velocity_cv", (_M.lightness.velocity.mild_above, _M.lightness.velocity.strong_above)
    ),
    BoundaryEntry(
        "stopChroma",
        "stop_chroma",
        (_M.hue.chromatic_above, _M.chroma.coherence.achromatic_below, _M.chroma.coherence.vivid_at_least),
    ),
    BoundaryEntry(
        "enclosingArc",
        "enclosing_arc",
        (_M.hue.arc.narrow_below, _M.hue.arc.wide_above, _M.hue.arc.clash_above),
    ),
    BoundaryEntry("hueSteps", "hue_steps", (_M.hue.direction.min_step,), absolute=True),
    BoundaryEntry(
        "chromaRange", "chroma_range", (_M.chroma.range.uneven_above, _M.chroma.range.spike_above)
    ),
    BoundaryEntry(
        "coherenceRatio",
        "coherence_ratio",
        (_M.chroma.coherence.dead_zone_below, _M.chroma.coherence.gap_below),
    ),
    BoundaryEntry(
        "segmentEndpointChroma", "segment_endpoint_chroma", (_M.chroma.midpoint.endpoint_chroma_above,)
    ),
    BoundaryEntry(
        "worstDip", "worst_dip", (_M.chroma.midpoint.slight_above, _M.chroma.midpoint.muddy_above)
    ),
    BoundaryEntry(
        "segmentGaps",
        "segment_gaps",
        (
            _M.lightness.abrupt_jump.max_gap,
            _M.chroma.banding.subtle_span_above,
            _M.chroma.banding.strong_span_above,
        ),
    ),
    BoundaryEntry(
        "edgeGap",
        "edge_gap",
        (_M.rhythm.edge.slight_above, _M.rhythm.edge.short_above, _M.rhythm.edge.bunched_above),
    ),
    BoundaryEntry("span", "span", (_M.rhythm.span.squeezed_below, _M.rhythm.span.narrow_below)),
    BoundaryEntry("gapCv", "gap_cv", (_M.rhythm.gaps.uneven_above, _M.rhythm.gaps.clustered_above)),
)

#: Default boundary tolerance: relative to the threshold, absolute below 1.
BOUNDARY_EPSILON: Final = 1e-6

__all__ = [
    "BOUNDARY_EPSILON",
    "BoundaryEntry",
    "Dimension",
    "ScoreMeasurements",
    "ScoringModelV1",
    "Severity",
    "Tier",
    "V1_BOUNDARY_TABLE",
    "V1_FINDING_CODES",
    "V1_MODEL",
]
