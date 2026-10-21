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

Without it the rule is self-defeating: the first project to self-host a font invalidates every
viewport forever, and a gate that always fails is a gate nobody reads.

**The exemption is a safety net, not the intended state — serve the font locally instead.**
This section used to argue the exemption was *safe* because a self-hosted font could never resolve
in the harness, so the fallback face was "the same face the harness has always measured" and the
baseline still described the rendered page. That reasoning was wrong in a way worth recording: it
made the harness measure a typeface **the product does not ship**, and the damage was not
hypothetical — `cmp-link`'s font-metric probe had to be recorded `status: "unmeasured"` because its
value depended on whether the runner had network egress to Google at measure time (`build/gate/LESSONS.md` §2.8),
and a `pat-wizard` geometry baseline was captured under Arial metrics and read as a regression the
moment Roboto arrived.

So `build/lib/virtual-origin.mjs` maps the `/<odcThemeModule>/` prefix (read from
`project.config.json`) onto the committed faces in `vendor/fonts/roboto/`. One authored path
resolves in **both** contexts: `dist/theme.css` stays byte-identical to what is pasted into ODC,
and the harness measures the face the product actually renders. That is what `build/gate/LESSONS.md` §2.8 means by
"re-arm it by making the font deterministic, then re-judge".

The exemption stays for the cases the alias does not cover — a project that has not yet committed
its faces, or a face served from somewhere else — but if a font 404s in this harness, the first
question is whether the alias is wired up, not whether to accept the fallback.

### Probe file

```json
{
  "waitFor": ".prefix-button",
  "viewports": [{ "name": "desktop", "width": 1280, "height": 900 },
                { "name": "mobile",  "width": 375,  "height": 812 }],
  "probes": [
    { "name": "primary / fill", "selector": ".btn.is-primary",
      "props": ["background-color", "color", "font-size", "border-radius"] },
    { "name": "primary / box",  "selector": ".btn.is-primary", "rect": true },
    { "name": "icon glyph",     "selector": ".btn .icon", "pseudo": "::before", "ink": true },
    { "name": "registered",     "js": "!!customElements.get('x-toast')" }
  ]
}
```

- `props` — `getComputedStyle`; add `"pseudo": "::before"` for generated content.
- `rect` — `getBoundingClientRect`, for boxes and gaps.
- `ink` — paints the codepoint to a canvas and takes its **alpha bounding box**. Design
  tools inset a glyph inside its em box (icon-font ink is typically ~62.5% of the em), so
  `font-size` alone proves nothing about what the eye sees.
- `js` — escape hatch for anything the above cannot express.
- `index` — disambiguates when a selector matches several elements.

Optional top-level `url` (defaults to the item's specimen page) and `waitFor`.

**A ref row you did not probe is a row you did not check.**

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
