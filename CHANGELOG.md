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

"Shipped" means merged to `main`. The loop opens a PR per item and never merges: a human merging the
PR is the approval, and only merged work reaches an OutSystems build.

Use these section headings, in this order, under each version: `Added`, `Changed`,
`Deprecated`, `Removed`, `Fixed`, `Security`. Write entries for the person integrating the
component, not for the person who wrote the commit — say what changed in the rendered result
and what they have to re-paste.

## [Unreleased]

**Leaner, and shaped around how projects actually work.** Board mode and the unattended loop
runner are gone — neither was used by a real project. CLAUDE.md is a short map. New checks catch
the gaps two real projects hit, and `npm run release` does the mechanical half of a release.
Existing projects: take `build/` from the template (README → "Pulling template improvements"),
then clear what `check:state` now warns about.

### Added

- **`npm run release -- patch|minor`.** Bumps the version, moves the Unreleased notes under the new
  heading, builds the ship theme and checks its header names the version, keeps it as
  `dist/theme-<version>.css` (the ODC paste — no more mixing it up with the dev copy), packages and
  records the ODC docs, restores the dev build, and prints the remaining steps.
- **Three new `check:state` warnings.** An item `status` outside the lifecycle list
  (`queued | built | ready-for-review | merged | handover | needs-human | needs-re-ref | deferred |
  closed`); a `probes.json` with no `measurements.json` (a regression test that never runs); a
  `handover/*.md` missing from `handover-map.json`. A prose-only handover maps to `[]`.

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

### Changed

- **Renamed to Live Style Guide Harness**, and its plugin to `lsg` (repo `live-style-guide-loop`).
  Commands are `/lsg:design-loop`, `@lsg:maker`, `@lsg:checker`. In an existing project, set
  `.claude/settings.json` → `enabledPlugins` to `"lsg@live-style-guide-loop": true` and point the
  `extraKnownMarketplaces` entry `live-style-guide-loop` at `kharloridado/live-style-guide-loop`.
- **`.claude/settings.json`** loads the `lsg` plugin, allows `npm run *` (review, gate, docs and
  release are daily commands), and drops the board-era grants (`gh project *`, `gh api graphql`,
  `gh pr merge`) and the hook that appended to `loop/loop.log`. `gh pr merge` now always prompts.
- **CLAUDE.md is a map, not a manual** — 219 → ~115 lines, built around the real workflow: a
  request in a session → one PR with its review Artifact → a human merges → handover → release.
- **`loop/state.json` is an index** — items and findings only, with a fixed field list. Run
  settings (mode, tiers, pauses, max rounds) moved to `loop/goal.md`, which is now optional and only
  needed for queue runs. Figma URL, file key and repo are no longer copied into either file.
- **Gate and CI lessons moved next to the gate**, in `build/gate/LESSONS.md` (same section numbers).
- **`validate:theme`** reports a missing OutSystems UI base as one setup step to run, instead of
  dozens of misleading "undefined token" lines.
- **CI** recognises the template by GitHub's *Template repository* flag rather than a hard-coded
  repo name, so a team's own copy behaves the same.
- **`setup-finding-labels.sh`** also creates the `deliverable` label the loop puts on its PRs.

### Removed

- **Board mode**: `loop/board-run.sh`, `.github/setup-project.sh`,
  `.github/migrate-project-status.sh`, the `deliverable` issue template, the `board` config block
  and its checks, and the `board:*` scripts. A merged PR is now the approval.
- **`loop/run.sh`** (the unattended runner) and **`loop/figma-links.md`** (provenance lives in each
  `ref.md`).
