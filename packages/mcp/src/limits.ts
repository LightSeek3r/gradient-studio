// Input caps. Every tool rejects (isError) input beyond these before doing any
// work, so a hostile or accidental huge request costs a bounded amount of CPU.

/** Longest `css` input, in UTF-16 code units (about 20 KB of ASCII). */
export const MAX_CSS_CHARS = 20_000;
/** Gradients examined per call; the rest are counted and reported, not scored. */
export const MAX_GRADIENTS = 32;
/** Stops in a structured `stops` input (the parser's own default is also 32). */
export const MAX_STOPS = 32;
/** Longest colour string. */
export const MAX_COLOR_CHARS = 200;
/** Largest and smallest preview edge, in pixels. */
export const MIN_PREVIEW_SIZE = 16;
export const MAX_PREVIEW_SIZE = 2048;
export const DEFAULT_PREVIEW_WIDTH = 480;
export const DEFAULT_PREVIEW_HEIGHT = 270;
/** Longest gradient excerpt echoed back in a result. */
export const MAX_ECHO_CHARS = 400;
/** `angle` bounds, CSS degrees. */
export const MAX_ANGLE = 3600;
