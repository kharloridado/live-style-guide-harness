# Changelog

All notable changes to this design system are recorded here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project
follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html) in the **0.x** range —
pre-1.0, so token and class renames are expected and are **not** treated as breaking. Bump the
MINOR for a new component or feature tier; bump the PATCH for fixes only.

The version lives in one place: the `version` field in `package.json`. The theme build reads it
and stamps it at the top of `dist/theme.css`, so the file a developer pastes into the ODC Theme
editor self-identifies and matches its entry below. See `CLAUDE.md` → "Releasing" for how
a release is cut.

"Shipped" means merged to `main`. Merging is not the same as delivered: **only board-Approved
items reach an OutSystems build**, and only a human moves an item to Approved.

Use these section headings, in this order, under each version: `Added`, `Changed`,
`Deprecated`, `Removed`, `Fixed`, `Security`. Write entries for the person integrating the
component, not for the person who wrote the commit — say what changed in the rendered result
and what they have to re-paste.

## [Unreleased]

### Added

- **Deploy through MCP, with a check at every step.** `deploy/CHECKLIST.md` takes merged work into
  OutSystems through a design-time MCP: gate (is an MCP active, are the modules open), read before
  write, dry run, apply and read back, merge and publish, verify in a consumer, record. Each step
  names its check and pass condition; the filled-in table goes in the PR or release notes.
  `CLAUDE.md` → "Deploying" makes it the first route and keeps the handover issue as the fallback
  when no MCP is active. Proven on an O11 project; ODC falls back until an ODC deploy passes it.
- **Platform rules 10–12** in `specs/foundations/platform.md`: per-row classes go on the Row Cells
  or the `<tr>` (Row Style is evaluated once per table); don't ListFilter a table's own list from a
  row event; a consumer runs the producer version it was last compiled with.
- **O11 projects.** `npm run init -- --environment=O11` sets up an OutSystems 11 project. It
  skips the ODC tenant, writes `odcTenant: null`, and writes no `.mcp.json`: on O11, design-time
  access goes through Service Studio's own MCP server. `check:config` passes without a tenant on
  O11, and `build:osui` builds the O11 version of OutSystems UI, so the fidelity gate measures
  against the framework the environment actually serves. ODC projects are unchanged.

- **Mentor guide: structural handovers.** `handover/MENTOR-STUDIO-PROMPT.md` gains a method for
  prompts that restructure a Layout or shared `Common` Blocks: start from the live DOM, give Mentor
  the target HTML with a widget legend ("build real widgets, never paste this HTML"), keep the
  prompt self-contained (Mentor sees the module, not the repo; imported `specs/` Markdown only once
  proven), placeholders over containers, one prompt per module in build order (theme module, then
  each consumer app), and verify the published page before sending a short delta prompt.
- **Design-system docs for ODC, as part of every release.** `npm run docs:odc` packages the
  agent-readable `specs/` Markdown for import into ODC as Resources — context for Mentor and for
  anyone using the Live Style Guide — flattened and link-rewritten. Each release ships everything
  and a zip of only what is new or changed since the last import (`handover/odc-docs-imported.json`).
- **Several Mentor prompts per handover.** A `handover-map.json` entry may give
  `mentor.prompts: [{ title, text }, …]`; `npm run embed:handover` renders each as its own
  subsection, for changes that span the theme module and consumer apps.
