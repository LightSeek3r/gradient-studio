// The results file: one JSON object per line.
//   {"briefId":"saas-hero-01","model":"my-model","condition":"baseline","output":"..."}
// Optional: "sample" (non-negative integer, default 0: repeated samples of the
// same brief) and "synthetic" (true marks hand-written harness-test data).

export interface ResultRecord {
  briefId: string;
  model: string;
  condition: string;
  sample: number;
  synthetic: boolean;
  output: string;
}

export interface Diagnostic {
  source: string;
  line?: number;
  code: string;
  message: string;
}

const NAME = /^[\w.:/@+ -]{1,100}$/;

export function parseResults(text: string, source: string): { records: ResultRecord[]; diagnostics: Diagnostic[] } {
  const records: ResultRecord[] = [];
  const diagnostics: Diagnostic[] = [];
  const bad = (line: number, code: string, message: string) => diagnostics.push({ source, line, code, message });
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/);
  lines.forEach((raw, idx) => {
    const line = idx + 1;
    if (raw.trim() === "") return;
    let v: unknown;
    try {
      v = JSON.parse(raw);
    } catch {
      return bad(line, "invalid-json", "line is not valid JSON");
    }
    if (v === null || typeof v !== "object" || Array.isArray(v)) return bad(line, "invalid-line", "line must be a JSON object");
    const o = v as Record<string, unknown>;
    for (const key of ["briefId", "model", "condition"] as const) {
      if (typeof o[key] !== "string" || !NAME.test(o[key])) return bad(line, "invalid-field", `"${key}" must be a string of 1-100 characters from [A-Za-z0-9_.:/@+ -]`);
    }
    if (typeof o.output !== "string") return bad(line, "invalid-field", '"output" must be a string');
    let sample = 0;
    if (o.sample !== undefined) {
      if (typeof o.sample !== "number" || !Number.isInteger(o.sample) || o.sample < 0) return bad(line, "invalid-field", '"sample" must be a non-negative integer');
      sample = o.sample;
    }
    if (o.synthetic !== undefined && typeof o.synthetic !== "boolean") return bad(line, "invalid-field", '"synthetic" must be a boolean');
    records.push({
      briefId: o.briefId as string,
      model: o.model as string,
      condition: o.condition as string,
      sample,
      synthetic: o.synthetic === true,
      output: o.output,
    });
  });
  return { records, diagnostics };
}
