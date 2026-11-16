// Library surface of @opal42/bench (working name).
export { BENCH_VERSION, CAVEAT, SCHEMA_VERSION, SCORING_MODEL, SYNTHETIC_NOTICE } from "./constants";
export { DEFAULT_BRIEF_SET, briefSetHash, parseBriefSet, validateBriefSet, type Brief, type BriefIssue, type BriefSet } from "./briefs";
export { extractGradients, type ExtractOptions, type ExtractedGradient, type Extraction, type GradientForm } from "./extract";
export { parseResults, type Diagnostic, type ResultRecord } from "./results";
export { deltaEOK, scoreOutput, scoreRecords, type BriefRecord, type GradientResult } from "./run";
export { aggregate, buildSummary, briefInfo, comparePairs, mergeSummaries, validateSummary, CORE_VERSION, type GroupAggregate, type PairComparison, type Provenance, type Summary } from "./summary";
export { renderHtml, renderMarkdown } from "./report";
export { BUILTIN_CONDITIONS, DEFAULT_TEMPLATE, WITH_SKILL_TEXT, emitPrompts, renderPrompt, type ConditionSpec, type PromptLine } from "./prompts";
export { bootstrapMeans, mean, median, mulberry32, normalCdf, pairedBootstrapCI, quantile, sd, wilcoxonSignedRank } from "./stats";
export { run } from "./run-cli";
export type { BenchIo } from "./io";
