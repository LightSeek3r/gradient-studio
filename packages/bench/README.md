# @opal42/bench (GradientBench v0)

Working package name; private workspace package, not published.

An **offline, model-agnostic** harness. It turns the answers a system gave to 100
UI design briefs into smoothness scores for the CSS gradients they contain. It
never calls a model, never uses the network and needs no API key: you run the
prompts yourself and give it a JSONL file back.

```sh
npm run build -w @opal42/gradient -w @opal42/bench   # from the repository root
npm run bench -- validate-briefs
npm run bench -- prompts --condition baseline --with-skill --out prompts.jsonl
#   ... run prompts.jsonl through your own model or agent ...
npm run bench -- score results.jsonl --out summary.json
npm run bench -- report summary.json --out report/    # summary.json, report.md, leaderboard.html
```

`examples/` holds a **synthetic** run (hand-written answers, every line marked
`"synthetic": true`) and the reports built from it. They test the harness and show
the formats; they are not model results.

**What the number means.** Perceptual smoothness by the Opal42 v1 definition. It
is not aesthetics, brand fit or human preference, and because the same metric
drives `refine`, a with-skill gain is expected by construction and is not
validation of the metric. Every report says so, with provenance (bench version,
scoring model, core version, brief-set hash), and no flag removes that.

Contents: `prompts/briefs.json` (+ schema), `src/extract.ts` (gradients from
CSS, SCSS, JSON, JSX, Tailwind), `src/run.ts` (scoring layer), `src/stats.ts`
(paired bootstrap, Wilcoxon), `src/report.ts` (Markdown and static HTML),
`src/run-cli.ts` (the CLI as `run(argv, io)`).

Full documentation (methodology, supported input forms, limitations, companion
human-preference study): [docs/bench.md](https://github.com/LightSeek3r/gradient-studio/blob/master/docs/bench.md).
Node 22 or newer.
