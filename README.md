# Live Style Guide Harness

Start every OutSystems design-system engagement here. Figma designs (or written specs of a live
app) in; three pasteable artifacts out: the **theme** (`dist/theme.css`), **block CSS** that
restyles native OutSystems UI widgets, and **vanilla JS Web Components**. Every build is reviewed
as a published Artifact: the component beside its Figma frame, its measured values against the
judged baseline, its findings, and the code to paste into ODC or O11.

## The harness, in three parts

An AI agent does the building. This repo and its plugin are the *harness* around it: what the agent
reads before it acts, what checks its work afterwards, and where its state lives.

| Part | What it is | Where |
|---|---|---|
| **Guides** — read before acting | Project values, a short rules map, specs and frozen refs, decisions | `project.config.json`, `CLAUDE.md`, `specs/` |
| **Sensors** — check after acting | Theme build + `var()` validation + token audit, state and stylesheet checks, the rendered-fidelity gate, CI, the plugin's pre-commit hook | `build/`, `.github/workflows/verify.yml` |
| **Behaviour** — versioned, shared | Skills, the `maker` / `checker` agents, hooks | the [`lsg`](https://github.com/kharloridado/live-style-guide-loop) plugin |

The split is deliberate: a project owns its values and its gates, and every project gets the same
behaviour from one plugin version. When the agent makes the same mistake twice, the fix is a check
in `build/` (whose error message says how to fix it) — not another paragraph in `CLAUDE.md`.

## Start a project

1. **Use this template** on GitHub to create the project repo, and clone it.
2. In Claude Code, trust the folder (that registers the plugin marketplace from
   `.claude/settings.json`), then run `/lsg:project-setup`. It fills
   `project.config.json` through `npm run init`, wires the plugins, the ODC MCP server and the Figma
   connector, creates the GitHub labels, and turns your list of deliverables into
   `loop/goal.md`'s inventory.
3. Then:

```bash
npm install
git submodule update --init vendor/outsystems-ui
npm run build:osui
npm run build:theme
```

4. Write `specs/foundations/` from the brand guidelines and the Figma library, and fill the
   environment sections of `specs/foundations/platform.md`.

Then ask for work in plain words — "build the button", "the input's error state doesn't match
Figma" — and review it from the Artifact link on its PR. `CLAUDE.md` has the rest.

## Adopting it for another team

- **Your own copy.** Create your org's template from this one and tick *Template repository* in its
  settings; CI uses that flag (not a repo name) to know the placeholders are expected.
- **Your own plugin source.** To pin or change behaviour, fork `live-style-guide-loop` and point
  `extraKnownMarketplaces.live-style-guide-loop` in `.claude/settings.json` at the fork. Keep the plugin
  name so the skill names stay the same.
- **Nothing project-specific lives outside `project.config.json`.** Class prefix, repo, Figma file,
  and tenant are read from it at build time and by every skill.

## Pulling template improvements into a project

`build/` is the template's: projects should not need to edit it. To take a newer version:

```bash
git remote add template https://github.com/<org>/live-style-guide-harness.git
git fetch template
git diff HEAD template/main -- build/ package.json .github/   # review first
git checkout template/main -- build/ .github/workflows/
npm install && npm run build:theme
```

If your project had to change a `build/` file, open a PR against the template instead, so the
next project gets it too.

Release notes for this template: [`CHANGELOG.md`](./CHANGELOG.md).
