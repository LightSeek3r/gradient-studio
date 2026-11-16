# The four anti-patterns you will meet most

One-line fixes, drawn from `spec/scoring-v1.md`. Thresholds are the v1 model's;
they define the score, they are not rules of good design. Always check a fix
against the design intent first.

## 1. Muddy sRGB midpoint (`chroma/muddy-midpoint`)

Two vivid colours whose 8-bit sRGB average is grey or dull, so the middle of the
blend drops most of its chroma (`#00ff00` to `#ff00ff` passes through `#808080`).
Fires when the worst segment loses more than 50% of its average endpoint chroma
(warning, 10 points) or more than 30% (info, 5 points).

**Fix:** insert a vivid stop between the two (a colour whose hue sits between
them), or pick endpoints with closer hues. In real CSS, `in oklab` or `in oklch`
avoids the dull midpoint when browser support allows. v1 still reports the
finding (it measures the sRGB midpoint), so mention that.

## 2. Wide hue arc (`hue/wide-arc`, `hue/direction-reversal`)

The chromatic stops span a large part of the colour wheel. The smallest arc
containing all hues is above 120 degrees (warning, 8 points) or, with three or
more chromatic stops, above 180 degrees (error, 20 points). `hue/direction-reversal`
(warning, 10 points) is the hue path turning back on itself.

**Fix:** keep hues within roughly 80-120 degrees (an analogous palette), or make
the hue move one way. The one-click refinement scales every hue towards the
centre so the arc is at most 80 degrees: expect large colour changes, so check
`largestColorShift`. A single-hue gradient (arc under 15 degrees) only gets an
`info` note (`hue/narrow-arc`).

## 3. Lightness reversal (`lightness/reversal`, `lightness/perceived-reversal`)

One stop is darker (or lighter) than both of its neighbours, so the gradient
dips and rises again. Error, 12 points per reversal. `perceived-reversal`
(warning, 6 points) is the same effect once colourfulness is added: a vivid
middle stop looks brighter than the grey next to it.

**Fix:** make lightness change in one direction along the gradient: move the
dipping stop's lightness between its neighbours' (the targeted fix does exactly
this and keeps its hue). If the dip is the design (a dark band), keep it and say so.

## 4. Bunched or uneven stops (`rhythm/edge-gap`, `rhythm/narrow-span`, `rhythm/uneven-gaps`)

The stops do not use the line. The gap before the first plus after the last
stop is above 10% (info), 20% (warning) or 40% (error); the first-to-last span
is under 40% (info) or 20% (warning); the gaps between stops vary a lot
(coefficient of variation above 0.25 info, above 0.5 warning).

**Fix:** run the first stop at 0% and the last at 100%, and space the others
evenly, unless a deliberate pause (a solid band) is wanted. Do not do this to
gradients with hard stops.
