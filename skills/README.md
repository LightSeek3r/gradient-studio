# Agent Skills

| Skill | What it does |
|---|---|
| [`gradient-quality`](gradient-quality/SKILL.md) | Before an agent emits or reviews a CSS gradient: score it with the `opal42` CLI or the MCP `score_gradient` tool, read the coded issues, and fix only what is unintentional. |

A skill is a folder with a `SKILL.md` (YAML frontmatter with `name` and
`description`, then instructions) following the open
[Agent Skills format](https://agentskills.io). The skill works with the CLI or
the MCP server alone; it needs neither a network nor an account.

## Install

Nothing is published yet (the package names are working names). From a checkout
of this repository, copy or link the folder to where your agent looks for
skills, for example:

```sh
# Claude Code, for the current project
mkdir -p .claude/skills && cp -r skills/gradient-quality .claude/skills/

# Claude Code, for every project
mkdir -p ~/.claude/skills && cp -r skills/gradient-quality ~/.claude/skills/
```

Other agents that read the format: put the folder in their skills directory
(the folder name must stay `gradient-quality`, it has to match the `name` in
`SKILL.md`). Then make the scorer available to the agent, either by building
the CLI (`npm run build:packages`, then `node packages/cli/dist/cli.js`) or by
registering the MCP server ([docs/mcp.md](../docs/mcp.md)).

## Principles it carries

- The score is a **smoothness score by a published definition**
  ([spec/scoring-v1.md](../spec/scoring-v1.md)), not a quality verdict.
- **No hard-coded threshold** (PLAN D5). The default advice is to remove
  `error` and `warning` findings that are not intentional; a user's own
  `--min-score` always wins.
- Refinements can change colours a lot; the agent checks `colorShift`, keeps
  brand colours, and asks or flags when they would change.

## Validate

```sh
node skills/gradient-quality/scripts/validate-skill.mjs skills/gradient-quality
```

The script has no dependencies and applies the reference validator's rules
(required `name` and `description`, allowed frontmatter fields, name format and
directory match, length limits, links resolve). It also runs in the test suite
of `packages/mcp`. The reference implementation (`skills-ref` on PyPI) was run
against the skill as well and accepts it, but it is not a dependency.
