import pkg from "../package.json";

/** Version of this package (single source: package.json). */
export const BENCH_VERSION: string = pkg.version;

/** Scoring model of @opal42/gradient that every number in a summary comes from. */
export const SCORING_MODEL = "v1";

/** Shape version of summary.json and of the results lines. */
export const SCHEMA_VERSION = 1;

/**
 * The caveat carried by every report (JSON, Markdown, HTML). There is no flag
 * that removes it and the tests assert that it is present, verbatim.
 */
export const CAVEAT =
  "Measures perceptual smoothness by the Opal42 v1 definition - not aesthetics, brand fit or human preference; the same metric drives the refine step, so with-skill gains are expected by construction and are not validation of the metric.";

/** Extra banner when any scored record is marked synthetic. */
export const SYNTHETIC_NOTICE =
  "SYNTHETIC DATA: these records were written by hand to test the harness and demonstrate the format. They are not outputs of any model and must not be read as model results.";

/** Paired bootstrap settings (fixed so the output is reproducible). */
export const BOOTSTRAP_RESAMPLES = 2000;
export const BOOTSTRAP_SEED = 0x0a1042;
export const BOOTSTRAP_LEVEL = 0.95;

/**
 * Reporting cut for "refine changed the colours a lot": mean OKLAB distance
 * between the original and the refined stops of one gradient. It is a
 * descriptive bucket, not a quality threshold (PLAN D5).
 */
export const LARGE_CHANGE_DELTA_E = 0.05;

/** Outputs longer than this many UTF-16 units are cut before extraction. */
export const MAX_OUTPUT_CHARS = 500_000;
