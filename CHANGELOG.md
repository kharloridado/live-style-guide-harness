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

- **Assess a design before building it.** The plugin's `/lsg:assess` takes a Figma mockup and
  says, region by region, what the Live Style Guide already has, what needs a new variant, what
  comes from OutSystems UI and what is new, with every value matched to a token. The plan lives in
  `assessments/<slug>/`, with an annotated screenshot, and its proposed rows go into
  `loop/goal.md` when the plan PR merges.
- **Audit an existing app's UI.** The plugin's `/lsg:ui-audit` reports, read-only, what an app
  should have reused — an OutSystems UI component, an existing Block or class, a CSS variable —
  and anything used more than once that is not a Block, and proposes the fixes as items for
  `loop/goal.md`. Its working folder, `ui-audit/`, is ignored.
- **Hard rule 11: reuse, never re-make.** Anything used in two or more places is one reusable
  Block, and what already exists — in OutSystems UI or the design system — is used, never written
  again.
- **Approved work gets built into OutSystems.** After a merge, the plugin's `/lsg:deliver` builds
  the Block, its Script and its Live Style Guide page into the modules through the OutSystems MCP
  and checks them in a browser; without an MCP the handover carries the same steps for a
  developer. Each delivery also adds the Markdown it changed in `specs/` to the modules' Resources
  (`npm run docs:odc`), not only each release. CLAUDE.md and `specs/foundations/platform.md` say
  so; pair with `lsg` 4.2.
- **MIT license** for the template. `npm run init` removes it on a fresh copy, so a client project
  chooses its own licence instead of inheriting this one.
- **`npm run release -- patch|minor`.** Bumps the version, moves the Unreleased notes under the new
  heading, builds the ship theme and checks its header names the version, keeps it as
  `dist/theme-<version>.css` (the ODC paste — no more mixing it up with the dev copy), packages and
  records the ODC docs, restores the dev build, and prints the remaining steps.
- **Three new `check:state` warnings.** An item `status` outside the lifecycle list
  (`queued | built | ready-for-review | merged | handover | needs-human | needs-re-ref | deferred |
  closed`); a `probes.json` with no `measurements.json` (a regression test that never runs); a
  `handover/*.md` missing from `handover-map.json`. A prose-only handover maps to `[]`.

- **O11 projects.** `npm run init -- --environment=O11` sets up an OutSystems 11 project. It
  skips the ODC tenant, writes `odcTenant: null`, and writes no `.mcp.json`: on O11 the MCP is
  Service Studio's own, configured per machine; without it, handovers carry Service Studio steps. `check:config` passes without a tenant on
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
- **The harness knows the Live Style Guide.** Every deliverable now has a documentation page, and
  the page ships with the code:
  - **Foundation pages render from the theme.** A `TokenReference` Block (inputs `Kind`,
    `Heading`, `Filter`, `Exclude`; an `Intro` placeholder) lists every token of its kind that the
    published theme declares — colour, font size, font weight, spacing, radius, border size,
    shadow — with a specimen, its live value and a copy button. A colour added to the theme
    appears on the Colors page at the next publish, with no page edit. Its required Script
    (`src/lsg/lsg-token-reference.js`) is called from the Block's OnReady, OnParametersChanged and
    OnDestroy, one instance per widget Id; its CSS (`src/lsg/lsg-token-reference.css`) is held to
    the token audit. `handover/lsg-foundations.md` installs both.
  - **Usage specs gain §9, "Live Style Guide"**: the page, definition, "When to use", provenance,
    preview and class inspector. `check:state` warns when a component or pattern spec lacks it.
- **L5 components are custom Blocks with a required Script.** Hard rule 5 changes: a component
  OutSystems UI does not ship is an OutSystems Block (widgets, placeholders, typed inputs) with at
  most one vanilla-JS Script exposing `window.<Ns>.<Block>.init / update / destroy`, called from
  the Block's OnReady, OnParametersChanged and OnDestroy. A handover-map JS destination naming a
  "Required Script" makes `embed:handover` derive the matching Mentor prompt (or Service Studio
  steps). Web Components remain for projects that already ship them.
- **Modules and applications are part of setup.** `project.config.json` → `modules` names where the
  work lands, by role: `theme`, `patterns`, `liveStyleGuide`, `template` (and `patPreview` on O11),
  with each one's kind, and on O11 its application. `npm run init` asks for each with the
  playbook's default names; `check:config` checks the kinds against the platform. It replaces
  `odcThemeModule`, which existing projects may keep: it is still read as the theme module.
- **The delivery channel follows the platform.** The OutSystems MCP when one is connected;
  otherwise every handover carries a Mentor Studio prompt (ODC) or Service Studio steps (O11), and
  each prompt names the module it runs in. `npm run init -- --odc-tenant=none` records an ODC
  project with no MCP access. `specs/foundations/platform.md` → "How work reaches the modules".
- **Review Artifacts wear the project's brand.** The review page's chrome — accent, neutrals and
  body font — is resolved at build time from the project theme over the OutSystems UI base, so a
  reviewer sees the design system's own colours and type around the specimens. A project with no
  theme of its own reviews in OutSystems UI's defaults. Status colours keep their own legible
  palette.
- **Several Mentor prompts per handover.** A `handover-map.json` entry may give
  `mentor.prompts: [{ title, text }, …]`; `npm run embed:handover` renders each as its own
  subsection, for changes that span the theme module and consumer apps.

### Changed

- **The ODC MCP comes from OutSystems' own plugin.** `npm run init` no longer writes `.mcp.json`;
  it removes an old `outsystems` entry and prints the one command each developer runs:
  `claude plugin install outsystems@outsystems --config tenant_hostname=<odcTenant>`.
  `check:config` fails while an `outsystems` entry remains in `.mcp.json`, because it duplicates
  or hides the plugin's server. Pair with `lsg` 4.3.
- **`npm run init` on a fresh copy** resets `CHANGELOG.md` to an empty `[Unreleased]` and the
  version to 0.0.0, so a new project does not inherit the template's release notes.
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
- **`validate:theme`** reports a missing OutSystems UI base as one setup step to run, instead of
  dozens of misleading "undefined token" lines.
- **CI runs on pull requests and `main` only**, and a newer push cancels the run it replaces. A
  branch without a PR no longer runs (or emails), and a PR commit runs once instead of twice.
- **CI** recognises the template by GitHub's *Template repository* flag rather than a hard-coded
  repo name, so a team's own copy behaves the same.
- **`setup-finding-labels.sh`** also creates the `deliverable` label the loop puts on its PRs.

### Removed

- **Web Components.** New projects build every custom component as a custom Block with a
  required Script. `npm run embed:handover` no longer generates Web Component or reference-element
  prompts and stops with a clear error on a JS file that is not a Block's Required Script; the Web
  Component templates are gone from `handover/MENTOR-STUDIO-PROMPT.md`, and `platform.md` rule 1
  is now about passing typed options to the Script. Pair with `lsg` 4.3, which drops the
  `outsystems-web-component` skill.

- **The `conventions` block** (`spacingBase`, `grid`, `breakpoints`, `defaultComponentSize` with
  `confirmed | assumed | TBD`). No project ever confirmed one. Spacing, grid and breakpoint rules
  are now enforced only when written in `specs/foundations/` or `specs/decisions.md`. Existing
  projects can delete the block; `check:config` ignores it.
- **`build/gate/LESSONS.md` and `loop/LESSONS.md`.** Their rules moved to `build/gate/README.md`
  ("Writing probes"), `specs/README.md` and `CLAUDE.md`; the incident stories, client examples and
  dated notes in build-script comments went with them.
- **Board mode**: `loop/board-run.sh`, `.github/setup-project.sh`,
  `.github/migrate-project-status.sh`, the `deliverable` issue template, the `board` config block
  and its checks, and the `board:*` scripts. A merged PR is now the approval.
- **`loop/run.sh`** (the unattended runner) and **`loop/figma-links.md`** (provenance lives in each
  `ref.md`).
