// Deterministic report renderers: Markdown and a self-contained static HTML
// page. No timestamps, no randomness, no external assets. Both always carry
// the caveat and the provenance; there is no option to leave them out.

import { SYNTHETIC_NOTICE, LARGE_CHANGE_DELTA_E } from "./constants";
import { compareStrings, type GroupAggregate, type PairComparison, type Summary } from "./summary";

// ── formatting ──────────────────────────────────────────────────────────

const NA = "n/a";

export function fmtNum(x: number | null | undefined, digits = 1): string {
  return x === null || x === undefined || !Number.isFinite(x) ? NA : x.toFixed(digits);
}

export function fmtPct(x: number | null | undefined): string {
  return x === null || x === undefined ? NA : `${(x * 100).toFixed(1)}%`;
}

export function fmtP(p: number | null | undefined): string {
  if (p === null || p === undefined) return NA;
  return p < 0.0001 ? "<0.0001" : p.toFixed(4);
}

export function fmtSigned(x: number | null | undefined, digits = 1): string {
  if (x === null || x === undefined) return NA;
  return (x > 0 ? "+" : "") + x.toFixed(digits);
}

function fmtIqr(g: GroupAggregate): string {
  const s = g.briefScore;
  return s.q1 === null || s.q3 === null ? NA : `${s.q1.toFixed(1)} to ${s.q3.toFixed(1)}`;
}

/** Leaderboard order: higher mean score first; ties and missing scores by name. */
export function ranked(groups: readonly GroupAggregate[]): GroupAggregate[] {
  return [...groups].sort((a, b) => {
    const x = a.briefScore.mean;
    const y = b.briefScore.mean;
    if (x !== y) {
      if (x === null) return 1;
      if (y === null) return -1;
      return y - x;
    }
    return compareStrings(a.model ?? "", b.model ?? "") || compareStrings(a.condition ?? "", b.condition ?? "");
  });
}

function label(g: GroupAggregate): { model: string; condition: string } {
  return { model: g.model ?? "all models", condition: g.condition ?? "all conditions" };
}

// ── Markdown ────────────────────────────────────────────────────────────

function mdCell(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/\|/g, "\\|").replace(/[\r\n]+/g, " ").replace(/[`*_<>]/g, (c) => `\\${c}`);
}

function mdTable(head: string[], rows: string[][]): string {
  const line = (cells: string[]) => `| ${cells.join(" | ")} |`;
  return [line(head), line(head.map(() => "---")), ...rows.map(line)].join("\n");
}

function mdGroupRows(groups: readonly GroupAggregate[]): string[][] {
  return ranked(groups).map((g) => {
    const l = label(g);
    return [mdCell(l.model), mdCell(l.condition), String(g.records), fmtPct(g.anyGradientRate), fmtPct(g.scorableRatio), fmtNum(g.briefScore.mean), fmtNum(g.briefScore.median), fmtIqr(g), fmtNum(g.meanMinScore)];
  });
}

const GROUP_HEAD = ["Model", "Condition", "Records", "Any gradient found", "Scorable (scored/found)", "Mean score", "Median", "IQR", "Mean of per-record minimum"];

export function renderMarkdown(s: Summary): string {
  const p = s.provenance;
  const out: string[] = [];
  out.push("# GradientBench report", "");
  out.push(`> **Read this first.** ${s.caveat}`, "");
  if (p.synthetic) out.push(`> **${SYNTHETIC_NOTICE}**`, "");
  out.push("## Provenance", "");
  out.push(
    mdTable(
      ["Field", "Value"],
      [
        ["Bench version", mdCell(p.benchVersion)],
        ["Scoring model", mdCell(p.scoringModel)],
        ["Core version (@opal42/gradient)", mdCell(p.coreVersion)],
        ["Brief set", `${mdCell(p.briefSet.name)} ${mdCell(p.briefSet.version)} (${p.briefSet.count} briefs)`],
        ["Brief-set hash", `\`${p.briefSet.hash}\``],
        ["Tailwind palette entries supplied", String(p.extraction.tailwindPaletteEntries)],
        ["Bootstrap", `${p.bootstrap.resamples} resamples, seed ${p.bootstrap.seed}, ${Math.round(p.bootstrap.level * 100)}% percentile interval`],
        ["Sources", p.sources.length ? p.sources.map(mdCell).join(", ") : NA],
      ],
    ),
    "",
  );
  if (s.groups.length === 0) {
    out.push("No records were scored.", "");
  } else {
    out.push("## Results by model and condition", "");
    out.push("Sorted by mean score (descending). Unit: the per-brief mean score of the gradients found in one answer. Ranking by a smoothness metric ranks smoothness only.", "");
    out.push(mdTable(GROUP_HEAD, mdGroupRows(s.groups)), "");
    out.push("## By condition (pooled over models)", "", mdTable(GROUP_HEAD, mdGroupRows(s.byCondition)), "");
    out.push("## By model (pooled over conditions)", "", mdTable(GROUP_HEAD, mdGroupRows(s.byModel)), "");
    out.push("## Paired comparison against the baseline condition", "");
    if (s.pairs.length === 0) out.push("No model has both a `baseline` condition and another condition.", "");
    else {
      out.push("Pairs are briefs scored in both conditions. Difference = condition minus baseline, in score points. The interval is a paired bootstrap percentile interval; p is the two-sided Wilcoxon signed-rank test. With-skill gains are expected by construction: the same metric drives refine.", "");
      out.push(
        mdTable(
          ["Model", "Condition", "Paired briefs", "Unpaired", "Mean baseline", "Mean condition", "Mean difference", "95% interval", "Wilcoxon p", "Better / tied / worse"],
          s.pairs.map((q) => [mdCell(q.model), mdCell(q.condition), String(q.pairedBriefs), String(q.unpairedBriefs), fmtNum(q.meanBaseline), fmtNum(q.meanCondition), fmtSigned(q.meanDelta), q.ci ? `${fmtSigned(q.ci.lo)} to ${fmtSigned(q.ci.hi)}` : NA, q.wilcoxon ? `${fmtP(q.wilcoxon.p)} (${q.wilcoxon.method}, n=${q.wilcoxon.n})` : NA, `${q.better} / ${q.tied} / ${q.worse}`]),
        ),
        "",
      );
    }
    out.push("## Most frequent finding codes", "", "Share of scored gradients carrying the code (top 5 per group).", "");
    out.push(
      mdTable(
        ["Model", "Condition", "Scored gradients", "Codes (share)"],
        ranked(s.groups).map((g) => [mdCell(g.model ?? ""), mdCell(g.condition ?? ""), String(g.refine.scoredGradients), g.findingCodes.length ? g.findingCodes.slice(0, 5).map((c) => `${mdCell(c.code)} ${fmtPct(c.share)}`).join("; ") : "none"]),
      ),
      "",
    );
    out.push("## How much would refine change the colours", "");
    out.push(`Mean OKLAB distance between the original and the refined stops (black to white is 1.0), over gradients whose colours refine would change. A change of ${LARGE_CHANGE_DELTA_E} or more is counted as large; that cut is a reporting bucket, not a quality threshold.`, "");
    out.push(
      mdTable(
        ["Model", "Condition", "Scored gradients", "Colours changed", "Mean ΔE (changed)", `Large (>= ${LARGE_CHANGE_DELTA_E})`, "Mean score gain per gradient"],
        ranked(s.groups).map((g) => [mdCell(g.model ?? ""), mdCell(g.condition ?? ""), String(g.refine.scoredGradients), fmtPct(g.refine.colourChangedRate), fmtNum(g.refine.meanDeltaE, 3), fmtPct(g.refine.largeChangeRate), fmtSigned(g.refine.meanScoreGain)]),
      ),
      "",
    );
  }
  if (s.diagnostics.length) {
    out.push("## Diagnostics", "");
    for (const d of s.diagnostics.slice(0, 50)) out.push(`- ${mdCell(d.source)}${d.line ? `:${d.line}` : ""} ${mdCell(d.code)}: ${mdCell(d.message)}`);
    if (s.diagnostics.length > 50) out.push(`- ... and ${s.diagnostics.length - 50} more (see summary.json)`);
    out.push("");
  }
  out.push("## Limits", "");
  out.push("- Smoothness by the v1 definition only; it has not been validated against human judgement (PLAN D5).");
  out.push("- Unit of analysis is the brief. Gradients the extractor cannot parse or the scorer skips (var(), alpha, radial, Tailwind palette classes without a palette, ...) lower the scorable ratio and are not scored.");
  out.push("- The brief set was written by one team and is small; see docs/bench.md for prompt-set bias.");
  out.push("");
  return out.join("\n");
}

// ── HTML ────────────────────────────────────────────────────────────────

export function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

const CSS = `
:root{color-scheme:light dark;--bg:#ffffff;--fg:#1a1a1a;--muted:#4a4a4a;--border:#8a8a8a;--soft:#f3f4f6;--accent:#0b57d0;--bar:#2f5fb3;--bar2:#9a4d00;--warn-bg:#fff1c9;--warn-fg:#3b2800;--warn-border:#8a5a00}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){--bg:#121212;--fg:#ececec;--muted:#b8b8b8;--border:#7a7a7a;--soft:#1e1e1e;--accent:#8ab4f8;--bar:#8ab4f8;--bar2:#f0b266;--warn-bg:#3a2e10;--warn-fg:#ffe9ad;--warn-border:#d9a441}}
:root[data-theme="dark"]{color-scheme:dark;--bg:#121212;--fg:#ececec;--muted:#b8b8b8;--border:#7a7a7a;--soft:#1e1e1e;--accent:#8ab4f8;--bar:#8ab4f8;--bar2:#f0b266;--warn-bg:#3a2e10;--warn-fg:#ffe9ad;--warn-border:#d9a441}
:root[data-theme="light"]{color-scheme:light}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
a{color:var(--accent)}
.skip{position:absolute;left:-999px;top:0;background:var(--bg);color:var(--fg);padding:.5rem 1rem;border:2px solid var(--accent)}
.skip:focus{left:8px;top:8px;z-index:10}
header,main,footer{max-width:72rem;margin:0 auto;padding:0 1rem}
header{display:flex;flex-wrap:wrap;gap:1rem;align-items:center;justify-content:space-between;padding-top:1rem}
h1{font-size:1.6rem;margin:.5rem 0}
h2{font-size:1.25rem;margin:2rem 0 .5rem}
p,li{max-width:70ch}
.caveat{background:var(--warn-bg);color:var(--warn-fg);border:2px solid var(--warn-border);border-radius:8px;padding:.25rem 1rem 1rem;margin:1rem 0}
.caveat h2{margin-top:.75rem}
.caveat p{font-size:1.05rem;font-weight:600;margin:.25rem 0}
.synthetic{border-style:dashed}
button{font:inherit;color:var(--fg);background:var(--soft);border:1px solid var(--border);border-radius:6px;padding:.3rem .7rem;cursor:pointer}
button:focus-visible,a:focus-visible,th button:focus-visible{outline:3px solid var(--accent);outline-offset:2px}
.scroll{overflow-x:auto;max-width:100%}
table{border-collapse:collapse;width:100%;font-size:.95rem}
caption{text-align:left;color:var(--muted);padding:.25rem 0 .5rem}
th,td{border:1px solid var(--border);padding:.35rem .6rem;text-align:left;vertical-align:middle}
th{background:var(--soft)}
td.num,th.num{text-align:right;font-variant-numeric:tabular-nums}
th button{all:unset;cursor:pointer;font-weight:700;text-decoration:underline dotted}
dl{display:grid;grid-template-columns:max-content 1fr;gap:.25rem 1rem}
dt{font-weight:700}
dd{margin:0;overflow-wrap:anywhere}
code{background:var(--soft);padding:0 .25rem;border-radius:4px}
svg{display:block;max-width:100%}
.bar{fill:var(--bar)}
.axis{stroke:var(--muted);stroke-width:1}
.ci{stroke:var(--bar);stroke-width:3}
.pt{fill:var(--bar2)}
.small{color:var(--muted);font-size:.9rem}
footer{padding-bottom:2rem;color:var(--muted)}
`;

const JS = `
(function(){
var root=document.documentElement,btn=document.getElementById('theme');
function sysDark(){return !!(window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches);}
function isDark(){var cur=root.getAttribute('data-theme');return cur?cur==='dark':sysDark();}
if(btn){btn.hidden=false;btn.setAttribute('aria-pressed',String(isDark()));
btn.addEventListener('click',function(){var next=isDark()?'light':'dark';root.setAttribute('data-theme',next);btn.setAttribute('aria-pressed',String(next==='dark'));});}
document.querySelectorAll('table[data-sortable]').forEach(function(t){
var heads=t.querySelectorAll('thead th');
heads.forEach(function(th,i){
var label=th.textContent;th.textContent='';
var b=document.createElement('button');b.type='button';b.textContent=label;
b.setAttribute('aria-label','Sort by '+label);th.appendChild(b);
b.addEventListener('click',function(){
var body=t.tBodies[0],rows=Array.prototype.slice.call(body.rows);
var asc=th.getAttribute('aria-sort')!=='ascending';
rows.sort(function(a,c){
var x=a.cells[i].getAttribute('data-v')||a.cells[i].textContent,y=c.cells[i].getAttribute('data-v')||c.cells[i].textContent;
var nx=parseFloat(x),ny=parseFloat(y),r=(!isNaN(nx)&&!isNaN(ny))?nx-ny:(x<y?-1:x>y?1:0);
return asc?r:-r;});
rows.forEach(function(r){body.appendChild(r);});
heads.forEach(function(h){h.removeAttribute('aria-sort');});
th.setAttribute('aria-sort',asc?'ascending':'descending');});});});
})();
`;

function histogramSvg(g: GroupAggregate, idPrefix: string): string {
  const max = Math.max(1, ...g.histogram);
  const w = 120;
  const h = 36;
  const bw = w / 10;
  const bars = g.histogram
    .map((c, i) => {
      const bh = c === 0 ? 0 : Math.max(1, Math.round((c / max) * (h - 2)));
      return `<rect class="bar" x="${(i * bw + 0.5).toFixed(1)}" y="${h - bh}" width="${(bw - 1).toFixed(1)}" height="${bh}"/>`;
    })
    .join("");
  const desc = g.histogram.map((c, i) => `${i * 10}-${i === 9 ? 100 : i * 10 + 10}: ${c}`).join(", ");
  const l = label(g);
  return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-labelledby="${idPrefix}-t"><title id="${idPrefix}-t">Distribution of per-brief mean scores for ${esc(l.model)}, ${esc(l.condition)}, in ten bins of ten points (${esc(desc)})</title>${bars}<line class="axis" x1="0" y1="${h - 0.5}" x2="${w}" y2="${h - 0.5}"/></svg>`;
}

function groupTable(caption: string, groups: readonly GroupAggregate[], idPrefix: string, withHist: boolean): string {
  const head = ["Model", "Condition", "Records", "Any gradient found", "Scorable", "Mean score", "Median", "IQR", "Mean of minimum"];
  const th = head.map((h, i) => `<th scope="col"${i >= 2 ? ' class="num"' : ""}>${esc(h)}</th>`).join("") + (withHist ? '<th scope="col">Distribution</th>' : "");
  const rows = ranked(groups)
    .map((g, i) => {
      const l = label(g);
      const cells = [
        `<th scope="row">${esc(l.model)}</th>`,
        `<td>${esc(l.condition)}</td>`,
        `<td class="num">${g.records}</td>`,
        `<td class="num" data-v="${g.anyGradientRate ?? ""}">${fmtPct(g.anyGradientRate)}</td>`,
        `<td class="num" data-v="${g.scorableRatio ?? ""}">${fmtPct(g.scorableRatio)}</td>`,
        `<td class="num" data-v="${g.briefScore.mean ?? ""}">${fmtNum(g.briefScore.mean)}</td>`,
        `<td class="num" data-v="${g.briefScore.median ?? ""}">${fmtNum(g.briefScore.median)}</td>`,
        `<td class="num">${esc(fmtIqr(g))}</td>`,
        `<td class="num" data-v="${g.meanMinScore ?? ""}">${fmtNum(g.meanMinScore)}</td>`,
      ];
      if (withHist) cells.push(`<td>${histogramSvg(g, `${idPrefix}${i}`)}</td>`);
      return `<tr>${cells.join("")}</tr>`;
    })
    .join("\n");
  return `<div class="scroll"><table data-sortable><caption>${esc(caption)}</caption><thead><tr>${th}</tr></thead><tbody>\n${rows}\n</tbody></table></div>`;
}

function pairSvg(pairs: readonly PairComparison[]): string {
  const withCi = pairs.filter((q) => q.ci && q.meanDelta !== null);
  if (withCi.length === 0) return "";
  const lo = Math.min(0, ...withCi.map((q) => q.ci!.lo));
  const hi = Math.max(0, ...withCi.map((q) => q.ci!.hi));
  const pad = (hi - lo) * 0.08 || 1;
  const min = lo - pad;
  const max = hi + pad;
  const left = 8;
  const width = 560;
  const x = (v: number) => (left + ((v - min) / (max - min)) * (width - 2 * left)).toFixed(1);
  const rowH = 26;
  const height = withCi.length * rowH + 30;
  const rows = withCi
    .map((q, i) => {
      const y = 18 + i * rowH;
      return `<line class="ci" x1="${x(q.ci!.lo)}" y1="${y}" x2="${x(q.ci!.hi)}" y2="${y}"/><circle class="pt" cx="${x(q.meanDelta!)}" cy="${y}" r="4"/>`;
    })
    .join("");
  const desc = withCi.map((q) => `${q.model} ${q.condition}: ${fmtSigned(q.meanDelta)} (${fmtSigned(q.ci!.lo)} to ${fmtSigned(q.ci!.hi)})`).join("; ");
  return `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="pairs-t"><title id="pairs-t">Mean paired difference in score points with 95 percent bootstrap interval, one row per table row below. ${esc(desc)}</title><line class="axis" x1="${x(0)}" y1="4" x2="${x(0)}" y2="${height - 18}"/>${rows}<text x="${x(0)}" y="${height - 4}" text-anchor="middle" font-size="11" fill="currentColor">0</text><text x="${left}" y="${height - 4}" font-size="11" fill="currentColor">${esc(fmtSigned(min, 1))}</text><text x="${width - left}" y="${height - 4}" text-anchor="end" font-size="11" fill="currentColor">${esc(fmtSigned(max, 1))}</text></svg>`;
}

export function renderHtml(s: Summary): string {
  const p = s.provenance;
  const parts: string[] = [];
  parts.push(`<section class="caveat${p.synthetic ? " synthetic" : ""}" aria-labelledby="caveat-h"><h2 id="caveat-h">Read this first</h2><p>${esc(s.caveat)}</p>${p.synthetic ? `<p>${esc(SYNTHETIC_NOTICE)}</p>` : ""}</section>`);
  const prov: [string, string][] = [
    ["Bench version", p.benchVersion],
    ["Scoring model", p.scoringModel],
    ["Core version (@opal42/gradient)", p.coreVersion],
    ["Brief set", `${p.briefSet.name} ${p.briefSet.version} (${p.briefSet.count} briefs)`],
    ["Brief-set hash", p.briefSet.hash],
    ["Tailwind palette entries supplied", String(p.extraction.tailwindPaletteEntries)],
    ["Bootstrap", `${p.bootstrap.resamples} resamples, seed ${p.bootstrap.seed}, ${Math.round(p.bootstrap.level * 100)}% percentile interval`],
    ["Sources", p.sources.length ? p.sources.join(", ") : NA],
  ];
  parts.push(`<section aria-labelledby="prov-h"><h2 id="prov-h">Provenance</h2><dl>${prov.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${k === "Brief-set hash" ? `<code>${esc(v)}</code>` : esc(v)}</dd>`).join("")}</dl></section>`);
  if (s.groups.length === 0) {
    parts.push('<section aria-labelledby="res-h"><h2 id="res-h">Results</h2><p>No records were scored.</p></section>');
  } else {
    parts.push(`<section aria-labelledby="res-h"><h2 id="res-h">Results by model and condition</h2><p class="small">Sorted by mean score, highest first. Unit: the per-brief mean score of the gradients found in one answer. Ranking by a smoothness metric ranks smoothness only. Column headers sort the table when scripts are enabled.</p>${groupTable("Per model and condition", s.groups, "g", true)}</section>`);
    parts.push(`<section aria-labelledby="cond-h"><h2 id="cond-h">By condition</h2>${groupTable("Pooled over models", s.byCondition, "c", false)}</section>`);
    parts.push(`<section aria-labelledby="model-h"><h2 id="model-h">By model</h2>${groupTable("Pooled over conditions", s.byModel, "m", false)}</section>`);
    let pairBody: string;
    if (s.pairs.length === 0) pairBody = "<p>No model has both a <code>baseline</code> condition and another condition.</p>";
    else {
      const rows = s.pairs
        .map(
          (q) =>
            `<tr><th scope="row">${esc(q.model)}</th><td>${esc(q.condition)}</td><td class="num">${q.pairedBriefs}</td><td class="num">${q.unpairedBriefs}</td><td class="num">${fmtNum(q.meanBaseline)}</td><td class="num">${fmtNum(q.meanCondition)}</td><td class="num">${fmtSigned(q.meanDelta)}</td><td class="num">${q.ci ? `${fmtSigned(q.ci.lo)} to ${fmtSigned(q.ci.hi)}` : NA}</td><td class="num">${q.wilcoxon ? `${fmtP(q.wilcoxon.p)} (${q.wilcoxon.method}, n=${q.wilcoxon.n})` : NA}</td><td class="num">${q.better} / ${q.tied} / ${q.worse}</td></tr>`,
        )
        .join("\n");
      const head = ["Model", "Condition", "Paired briefs", "Unpaired", "Mean baseline", "Mean condition", "Mean difference", "95% interval", "Wilcoxon p", "Better / tied / worse"];
      pairBody = `<p class="small">Pairs are briefs scored in both conditions. Difference = condition minus baseline, in score points. Interval: paired bootstrap percentile (${p.bootstrap.resamples} resamples, seed ${p.bootstrap.seed}). p: two-sided Wilcoxon signed-rank test. With-skill gains are expected by construction because the same metric drives refine.</p>${pairSvg(s.pairs)}<div class="scroll"><table><caption>Condition against baseline, per model</caption><thead><tr>${head.map((h, i) => `<th scope="col"${i >= 2 ? ' class="num"' : ""}>${esc(h)}</th>`).join("")}</tr></thead><tbody>\n${rows}\n</tbody></table></div>`;
    }
    parts.push(`<section aria-labelledby="pair-h"><h2 id="pair-h">Paired comparison against the baseline condition</h2>${pairBody}</section>`);
    const codeRows = ranked(s.groups)
      .map((g) => `<tr><th scope="row">${esc(g.model ?? "")}</th><td>${esc(g.condition ?? "")}</td><td class="num">${g.refine.scoredGradients}</td><td>${g.findingCodes.length ? g.findingCodes.slice(0, 5).map((c) => `<code>${esc(c.code)}</code> ${fmtPct(c.share)}`).join("; ") : "none"}</td></tr>`)
      .join("\n");
    parts.push(`<section aria-labelledby="codes-h"><h2 id="codes-h">Most frequent finding codes</h2><div class="scroll"><table><caption>Share of scored gradients carrying the code (top 5 per group)</caption><thead><tr><th scope="col">Model</th><th scope="col">Condition</th><th scope="col" class="num">Scored gradients</th><th scope="col">Codes (share)</th></tr></thead><tbody>\n${codeRows}\n</tbody></table></div></section>`);
    const refRows = ranked(s.groups)
      .map((g) => `<tr><th scope="row">${esc(g.model ?? "")}</th><td>${esc(g.condition ?? "")}</td><td class="num">${g.refine.scoredGradients}</td><td class="num">${fmtPct(g.refine.colourChangedRate)}</td><td class="num">${fmtNum(g.refine.meanDeltaE, 3)}</td><td class="num">${fmtPct(g.refine.largeChangeRate)}</td><td class="num">${fmtSigned(g.refine.meanScoreGain)}</td></tr>`)
      .join("\n");
    parts.push(`<section aria-labelledby="ref-h"><h2 id="ref-h">How much would refine change the colours</h2><p class="small">Mean OKLAB distance between original and refined stops (black to white is 1.0), over gradients whose colours refine would change. A change of ${LARGE_CHANGE_DELTA_E} or more is counted as large; that cut is a reporting bucket, not a quality threshold.</p><div class="scroll"><table><caption>Refine change statistics</caption><thead><tr><th scope="col">Model</th><th scope="col">Condition</th><th scope="col" class="num">Scored gradients</th><th scope="col" class="num">Colours changed</th><th scope="col" class="num">Mean ΔE (changed)</th><th scope="col" class="num">Large (&gt;= ${LARGE_CHANGE_DELTA_E})</th><th scope="col" class="num">Mean score gain per gradient</th></tr></thead><tbody>\n${refRows}\n</tbody></table></div></section>`);
  }
  if (s.diagnostics.length) {
    const items = s.diagnostics.slice(0, 50).map((d) => `<li>${esc(d.source)}${d.line ? `:${d.line}` : ""} <code>${esc(d.code)}</code>: ${esc(d.message)}</li>`).join("");
    parts.push(`<section aria-labelledby="diag-h"><h2 id="diag-h">Diagnostics</h2><ul>${items}</ul>${s.diagnostics.length > 50 ? `<p>... and ${s.diagnostics.length - 50} more (see summary.json)</p>` : ""}</section>`);
  }
  parts.push(`<section aria-labelledby="lim-h"><h2 id="lim-h">Limits</h2><ul><li>Smoothness by the v1 definition only; not validated against human judgement (PLAN D5).</li><li>Unit of analysis is the brief. Gradients the extractor cannot parse or the scorer skips lower the scorable ratio and are not scored.</li><li>The brief set is small and written by one team; see docs/bench.md for prompt-set bias.</li></ul></section>`);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>GradientBench report</title>
<style>${CSS}</style>
</head>
<body>
<a class="skip" href="#main">Skip to the results</a>
<header><h1>GradientBench report</h1><button id="theme" type="button" aria-pressed="false" hidden>Dark mode</button></header>
<main id="main">
${parts.join("\n")}
</main>
<footer><p>Opal42 bench ${esc(p.benchVersion)}, scoring model ${esc(p.scoringModel)}. Generated offline; this page loads nothing from the network.</p></footer>
<script>${JS}</script>
</body>
</html>
`;
}
