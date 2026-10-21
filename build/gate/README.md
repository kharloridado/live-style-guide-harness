# `build/gate/` — the rendered-fidelity gate

Two deterministic Node scripts. They **measure and diff**; they never judge.

| | The question | Who answers | Cadence |
|---|---|---|---|
| Build time | *Is this right?* — the render vs the frozen Figma ref | the checker (an agent) | once per item |
| Every push | *Did this change?* — vs the committed baseline | `compare-measurements.mjs` | free, forever |
| On demand | *Is this still right?* — re-judge, no rebuild | `/lsg:revalidate` | when asked |

## Why these live in the template and not in the plugin

They are not *behaviour*. They are deterministic tooling that measures and diffs, exactly
like `build-theme.mjs` and `validate-theme.mjs`, and they sit here beside them. The plugin
holds the **instructions** for using them — when to probe, what a drift means, what may
never be relaxed — which is the part that actually goes stale when copied.

Consequence: a project picks up an improvement here by pulling the scaffold, not by
`/plugin update`. That is the same trade every other `build/` script already makes.

## `measure-fidelity.mjs`

```bash
node build/gate/measure-fidelity.mjs \
  --probes     specs/components/<item-id>/probes.json \
  --out        specs/components/<item-id>/measurements.json \
  --screenshot review/<item-id>/rendered.png
```

Run it from the **project root**. With no `url` in the probe file it rebuilds
`review/<item-id>/specimen.html` from the item's `specimen.html` (see `specs/README.md`) and
measures that. Pages are served from a virtual origin inside the browser context
(`build/lib/virtual-origin.mjs`), so no port is bound. It drives a headless browser and reads
`getComputedStyle` — never the authored source.

It refuses a `dist/theme.css` older than `tokens/` or `src/blocks/` (exit 4): the theme is
gitignored, and a stale copy measures a page nobody ships. Every declared font face is loaded
before measuring, so a probe's result does not depend on what else is on the page.

> A correct declaration in our source proves nothing. Framework and provider CSS
> out-specify it and win silently, so the review must cite the computed style.

**It never reads the ref**, so it cannot call drift. It reports numbers and an exit code;
the checker compares them to the ref. Keeping mechanism and judgment apart is what stops
the gate from grading itself.

### Exit codes — read these before you read any number

| Exit | Meaning | Verdict |
|---|---|---|
| `0` | every probe measured | compare to the ref → PASS or DRIFT |
| `3` | something could not be measured | `VISUAL: unverified` — **never** PASS |
| `4` | no usable browser, or the page never loaded | `VISUAL: unverified` — **never** PASS |
| `2` | usage fault (bad args, unreadable probe file) | also never PASS |

Any non-zero exit is a **harness fault, not a design verdict**.

### The failed-request rule

A failed **stylesheet, font or script** invalidates the entire viewport. A missing CSS file
does not throw — the cascade falls back and every computed value still reads as a perfectly
plausible number describing a page nobody will ever see. The commonest cause is
the framework base never being built:

```bash
git submodule update --init && npm run build:osui
```

**One exemption: the theme's own webfonts.** A self-hosted face points at an ODC Resource
(`/<odcThemeModule>/x.woff2`) and **ODC rewrites that `src` at compile time**, so the authored
path is not the path that ships (`specs/foundations/platform.md` §7). Those requests are recorded with
`critical: false` and do not invalidate the viewport; **every other font stays critical.**

**Serve the fonts locally rather than leaning on the exemption.** `build/lib/virtual-origin.mjs`
maps the `/<odcThemeModule>/` prefix onto the faces committed under `vendor/fonts/`, so one authored
path resolves in ODC and in the harness, and the gate measures the face the product renders. If a
font 404s here, wire up the alias before accepting the fallback, then re-judge any baseline that
was measured on the fallback face.

### Writing probes

A probe is a claim about what **this item's override owns**. Before pinning a value, ask what would
have to change for it to move; if the answer includes the theme, a webfont or another item's
specimens, the number is not the claim — find the claim.

- **No page-wide questions.** A probe that enumerates or counts across the whole theme or document
  (every `:root` property, every `.btn`, every rule in every sheet) goes red whenever any other item
  lands. Scope it to the item's own section, class or sheet.
- **Read selectors normalised.** `build/review/state-gate.js` rewrites `:hover` / `:active` /
  `:focus` / `:focus-visible` page-wide to `:is(:hover, .<prefix>gate-hover)`. Strip that wrapper
  before comparing `selectorText`.
- **Every block rule is on the page twice** — once inside `dist/theme.css`, once from its own
  `src/blocks/` file. A test that deletes a rule from the CSSOM must delete both copies.
- **No geometry on moving elements.** A rotating or animating element has no stable rect; assert its
  computed style instead.
- **Measure all three device rungs.** OutSystems puts `tablet` on `<body>` at a 1024px window, so
  `.tablet`-scoped framework rules fire on an ordinary laptop. Probe at desktop, tablet and phone.
- **Specimen chrome ships nothing.** `<prefix>specimen__*` classes live in `build/review/specimen.css`,
  not in the theme. Handover markup must never contain one.
- **The harness is not the product.** No framework base means no framework collisions; ODC also loads
  `OutSystemsReactWidgets`, which the submodule lacks (`specs/foundations/platform.md`). Anything
  the harness supplies that ODC does not, or the reverse, is a defect waiting at paste time.
- **A baseline restated by hand goes through CI before it is trusted.**

## `compare-measurements.mjs`

```bash
node build/gate/compare-measurements.mjs --all                        # CI
node build/gate/compare-measurements.mjs --baseline a.json --current b.json
```

`--all` walks every `specs/<kind>/<id>/` that has both a `probes.json` and a committed
`measurements.json`, re-measures, and diffs. Every committed probe set is therefore a
permanent visual regression test, and the suite grows with each deliverable — so a token
change that breaks component #3 is caught while building component #9.

### The comparison is typed by stability

This detail is load-bearing:

- **Computed strings** (colour, `font-family`, `font-size`, radius, weight) are
  environment-stable and diff **exactly**. A diff here is a **regression** and fails CI.
  The highest-value catch — a webfont silently falling back to a system stack — is a
  `font-family` string diff, and that is perfectly stable.
- **`rect` / `ink` geometry** depends on font rasterisation and is compared with a
  tolerance (default 1.5 px), reported as **informational** only.

A naive deep-equal would fail every pull request on sub-pixel noise, and a gate that cries
wolf every time teaches people to click through it — at which point it misses the real
regression too.

### There is deliberately no `--update`

A baseline is a **judged** artifact. Refreshing one without re-judging would launder an
unreviewed change into the record. If a token change is intentional, re-judge the item with
`/lsg:revalidate`.

## `npm run gate:selftest`

Measures `selftest.html`, a self-contained page with no theme, no vendor CSS and no
webfont. It proves the **harness** works — browser launches, server serves, all five probe
kinds read — independently of any project build output.

When the self-test passes and a real probe run does not, the fault is in the project, not
the gate. That is the difference between an exit `3` you fix with `npm run build:osui` and
an exit `4` you fix by installing a browser.

## The browser

`playwright-core` against an **installed Chrome or Edge** — no 140 MB Chromium download.
Resolution order: `GATE_BROWSER_PATH` → `chrome` → `msedge` → `chromium`. GitHub's
`ubuntu-latest` runners ship Chrome, so CI takes the same path with no extra setup.

If you would rather have a pinned, bundled browser, `npm i -D playwright` and set
`GATE_BROWSER_PATH` — nothing else changes.
