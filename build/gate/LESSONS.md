# Fidelity gate and CI lessons

What the specimen page, the probes and CI taught the hard way. Numbered as they were in
`loop/LESSONS.md`, so older PRs and commits still resolve. Class names use the reference project's
`wf-` prefix; read them as `<classPrefix>-`.

---

### 2.5 Order the CI steps by what they read, not by what they are named

`verify.yml` ran `build:osui` **after** `build:theme`. `npm run build:theme` chains `validate-theme.mjs`,
which resolves every `var(--token)` in the assembled theme — and a block override legitimately borrows
framework-owned tokens (`--color-neutral-0`, `--space-m`) that OutSystems UI declares and we do not. With
no compiled base on disk yet, all 14 were reported dangling and the gate failed.

**It was invisible until the first component, and then it looked like the component's fault.** The
token items declare the names they use, so they validate with no framework present; `main` stayed green.
The first item to *borrow* a framework token was the first to hit it — and it hit three at once
(`cmp-checkbox`, `cmp-input`, `cmp-dropdown`), all of which had passed the checker locally where
`build:osui` had been run by hand long before.

The validator printed the cause in its own output — *"outsystems-ui.css is missing, so framework tokens
cannot be resolved"* — and it was read past, because the deterministic gate is a hard wall by design and
a hard wall is assumed to be telling the truth about the code rather than about itself.

**The rule:** a step's position is a function of what it reads. Anything that reads the compiled
framework base runs after `build:osui`, and that is worth a comment at the step, because the next person
reordering the file will not re-derive it.

### 2.6 A probe that enumerates the whole theme is a tripwire, not a regression check

Three `tok-foundations` probes asserted theme-*global* facts: every non-`:root` rule `dist/theme.css`
ships, its total rule count (`"stylesheet loaded, 2 rules"`), and every `var(--wf-*)` reader in the
loaded CSS. All three were true the day they were written and are falsified by *any* component landing
afterwards — the checkbox alone takes the rule count from 2 to 24.

That is not drift detection. It reports "something changed" whenever the intended thing changes, and its
only available response is to re-baseline. It had in fact been re-baselined once already (`2 rules` →
`3 rules`, when the webfont rules landed) — which is the tell: a check whose routine outcome is "update
the expected value" has stopped being a check, and the habit it builds is the one that waves a real
regression through.

**Write the invariant, not the snapshot.** The claims those probes were really making all survive
narrowing, and none mentions anything a later item can add:

- the token layer emits exactly one element rule — `html { font-family: … }`
- the theme consolidates to exactly **one** `:root` block (which `CLAUDE.md` requires anyway)
- that `html` rule really does read a `--wf-` token

The same trap has a geometric form: a probe returning absolute page-Y coordinates as a JSON blob is
string-compared, so it bypasses the `rect` tolerance that exists to absorb layout shift, and fails
whenever *anything above it on the page* moves. Assert sizes and relative offsets.

**Corollary for restating a baseline by hand.** It is sometimes right — much cheaper than a full
re-measure when the expected value is genuinely knowable — but only safe if the restated value goes
through CI *before* it is trusted. One of the three above was restated with a regex that stopped before
the closing paren, so the probe would have reported a truncated `var(--wf-font-family-base` forever. CI
caught it in one run. A hand-written expectation never independently measured is just two guesses
agreeing with each other.

### 2.7 The state gate rewrites the CSSOM for the whole page — read selectors normalized

Every specimen page loads `build/review/state-gate.js`. On load it walks every stylesheet and rewrites
each `:hover` / `:active` / `:focus` / `:focus-visible` selector **in place** to, e.g.,
`:is(:hover, .wf-gate-hover)`, so a cell tagged `data-gate="hover"` renders hovered instead of at rest
under a caption that lies. The rewrite is specificity-preserving (`:is()` takes the specificity of its
most specific argument, and `.wf-gate-hover` is (0,1,0) exactly like `:hover`), and an untagged element
matches neither arm — so **nothing renders differently**.

But it is a page-global mutation — it rewrote 256 rules the moment the first item shipped one — and
because every specimen page links `dist/theme.css`, every item's rules are on every item's page, gated.
Any probe that *reads* `selectorText` therefore sees `…[data-checkbox]:is(:hover, .wf-gate-hover)` where
a baseline measured before the gate recorded `…[data-checkbox]:hover` — including probes belonging to a
completely different item. Three `cmp-checkbox` probes failed exactly this way when `cmp-input` merged:
same sheet, same rule, same computed border, different string.

**So a probe that reports a selector reports the *authored* one:**

```js
const N = s => s.replace(/:is\(\s*(:[a-z-]+)\s*,\s*\.wf-gate-[a-z-]+\s*\)/g, '$1');
```

Filters may test the raw text — the rewritten form still contains `:hover` — but anything that ends up
in the probe's *output* goes through `N` first. Then a baseline means the same thing whether or not the
gate ran, and whether or not another item's specimen is `<!-- include: -->`d onto the page — the
property a regression check needs and a snapshot does not have.

The general shape is the same as §2.6: **a probe must not measure things its item does not own.**
Page-wide totals and page-wide selector text are both that mistake, and both only show up later, in
someone else's PR, looking like their fault.

### 2.8 A probe value can be *theme*-sensitive, not just page-sensitive — assert what your override owns

§2.6 and §2.7 are about probes reading things the *page* owns. There is a third form, easier to mistake
for a real defect: a probe reading a computed value that the **theme** also feeds.

Two `cmp-dropdown` / `cmp-input` probes failed this way when the two items first shared a page, and both
looked at first like geometry regressions:

- `SIBLING / server-side dropdown NOT touched` measured `height`, which went **16px → 21px**. The only
  rules matching that element are OutSystems UI's own, one of them `height: inherit` — so the height is
  the *theme's* line-height, and it moved because `dist/theme.css` now loads Roboto. The probe's own
  claim ("this override does not touch it") was never in question.
- An RTL probe pinned the computed `left` of a leading icon, which moved 17px. The host is injected
  `position:absolute` with auto width, so it shrink-to-fits around an `<input>` whose default width is
  font-dependent — the same webfont change, one layer removed.

In both cases the *assertion* held and only the number moved. A probe that measures `height` to prove
"I did not style this" is measuring the wrong thing: **state the claim directly.**

```js
// not: height === 16px
// but: does MY stylesheet match this element at all?
const mine = [...document.styleSheets].filter(s => (s.href||'').endsWith('wf-dropdown.css'));
// → { wfDropdownRulesMatching: 0, selectors: [] }
```

(This works because the specimen page links each `src/blocks` file as its own sheet as well as inside
`dist/theme.css` — see §2.12.) That version cannot be falsified by a font, a line-height or a sibling
item, and it is strictly stronger: it would also catch the override leaking onto the element with
*identical* computed values, which the height check never could.

**Rule of thumb for all three forms:** before pinning a number, ask what would have to change for it to
move. If the honest answer includes "the theme", "the webfont" or "another item's specimens", the number
is not the claim — find the claim.

### 2.9 An unclosed CSS rule deletes the next section, silently — and merges are where it happens

Three times on this project a hand-resolved merge conflict fell **inside** a rule, left it open, and
silently removed the following section from the rendered page. (The chrome classes were then named
`wf-preview__*`, in `preview/preview.css`; they are now `wf-specimen__*`, in
`build/review/specimen.css`.)

| | left open | swallowed | how it presented |
|---|---|---|---|
| `cmp-input` onto `cmp-checkbox` | `.wf-specimen__variant-name` | `.wf-specimen__grid` | input specimens measured `324px → 1020px` — read as a component fidelity regression |
| primitives merges | `.wf-specimen__stack--tall` | the whole `cmp-button` section | — |
| primitives merges | `.wf-specimen__spinner` | the whole `cmp-link` section | `.wf-specimen__icon` vanished; **eight** "element has a zero-size box" regressions against a component whose CSS was correct. `main` red for three runs |

**Why nothing caught it.** An unclosed rule is *not a syntax error*. The parser treats everything after it
as further declarations of that rule, finds them invalid, drops them, and reports nothing. The sheet still
loads and still has a non-zero `cssRules.length` — it is merely missing the rules that were swallowed. No
browser warning, no build error, no failing lint.

**And the gate already knew how to catch it.** `validate-theme.mjs` has run exactly this check since it
was written, and says in its own comments that an unbalanced brace is "the single most likely way to
corrupt the whole theme". It ran on `dist/theme.css` alone. But `dist/theme.css` is *assembled* — the
files that actually get corrupted are the ones people **merge by hand**. The check was right; its scope
was wrong.

`npm run check:stylesheets` now runs it over every hand-edited stylesheet directory (the `DIRS` list in
`build/check-stylesheets.mjs`), in CI and ahead of `build:theme`. The scanner lives in
`build/lib/css-structure.mjs` with one caller each side. The specimen chrome is hand-merged too, so its
directory belongs in that list.

**The transferable part is the diagnosis, not the fix.** All three times the gate reported a *component*
regression — wrong widths, zero-size boxes — and the component was innocent. When measurements go wrong
in a way that looks structural rather than stylistic, check that the stylesheet parses before reading the
numbers as a verdict on the CSS.

### 2.10 A gate must not re-wrap its own rewrite; a rotating element has no stable rect

Two more ways the gate lied about a component, both found while getting `main` green after the
primitives merged, and one collision that is not about the gate at all.

**Re-wrapping.** The old preview ended up with **two** state-gate scripts (`cmp-input` brought one,
`cmp-button` another). Both walked the whole CSSOM, and the rewrite regex matched `:hover` wherever it
appeared — **including inside the `:is(:hover, .wf-gate-hover)` the first pass had just written**. Every
gated selector came out as

```
.btn:is(:is(:hover, .wf-gate-hover), .wf-gate-hover)
```

one level deeper per extra pass. Nothing rendered differently — `:is()` takes the specificity of its most
specific argument either way — so only the checker's selector audits noticed.

There is now one gate, `build/review/state-gate.js`, but it keeps the guard: a lookahead,
`(?!,\s*\.wf-gate-)`, that stops any second pass re-wrapping a pseudo it already wrapped. It is
deliberately per-pseudo rather than "skip any selector already gated", so a selector like
`.btn:is(:hover, .wf-gate-hover):active` still gets its `:active` gated — the Pressed cells depend on it.
If you touch the regex, keep both properties; `N` in §2.7 assumes one level of wrapping.

**A rotating element has no stable bounding rect.** The button's blast-radius probe measured the loading
spinner with `getBoundingClientRect()`. The spinner *spins*: the axis-aligned box of a rotating 16px
square runs from 16px at 0° to 22.6px at 45°, so the probe read 21 or 22 at random and failed against
itself between two consecutive runs of the same code.

`offsetWidth` / `offsetHeight` are the layout box and ignore transforms, so they are stable; the
containment claim the probe actually makes (`insidePaddingBox`) is a boolean and was never the problem.
**If a probe disagrees with a re-run of itself, the probe is wrong** — re-baselining it just moves the coin
flip.

**Chrome classes are a shared namespace.** `.wf-specimen__grid` and `.wf-specimen__cell` (then
`wf-preview__*`) were each defined twice, by different items, with different values. While the chrome
stylesheet was broken (§2.9) the second definition was dropped, so nobody saw it; fixing the braces made
the collision real and the input's specimens went `324px → 217px`. An item that needs its own layout
scopes it to its own modifier (`.wf-specimen__grid--5`); it does not redefine the shared base.

### 2.11 §2.6's tripwire has a per-*item* form: ask what the probe would have to own to be right

§2.6 caught the theme-global probes. The same defect survived one level down, in probes that look properly
scoped because they name a component — and still ask a page-WIDE question:

| item | probe | the page-wide question it was really asking |
| --- | --- | --- |
| `tok-foundations` | `PROOF / … declares ON :root` | *enumerate* every `:root` custom property |
| `cmp-button` | `AUDIT / how many .btn …` | count `.btn` on the whole document |
| `cmp-checkbox` | `cascade / which sheet last sets …` | every `[data-checkbox]` rule in every sheet |
| `cmp-checkbox` | `label <-> input association` | every `.wf-checkbox__label` on the page |

None of them mentions another item, and all four go red when one lands. `cmp-option-card` (#35) tripped
every one while its *own* baseline reported "no change" — the §2.7 failure mode exactly: the gate blamed
the newcomer for four earlier items' probes.

**The test that separates the two.** Not "does this probe name my component" but *"if another item adds a
specimen or a token tomorrow, does my expected value move?"* If yes, the probe is measuring the page, not
the item — whatever it is called.

**The four fixes are all the same move: name the boundary.** Enumeration → a FIXED list of names read with
their values (`tok-foundations`); document → the item's own section, `#wf-btn` (`cmp-button`); every sheet
→ only rules this block owns, i.e. carrying no other `.wf-` block's class (`cmp-checkbox` cascade); every
label → labels inside a `.wf-checkbox` (`cmp-checkbox` a11y). Each new probe name states the boundary
*and* what it deliberately excludes, so the next person does not "fix" it by widening it again.

Narrowing is not weakening here — it was checked both ways. Each scoped probe still fails when the thing
it owns really breaks (drop a `wf-button--soft` inside `#wf-btn`; break one `for=`; add a
`.wf-checkbox--*` rule), and the `tok-foundations` one got *stronger*: reading name **and value** catches
`--border-radius-soft: 8px → 7px`, which the name-only enumeration passed straight through. The cascade
probe's 54 entries come back byte-identical, in the same order, with `cmp-option-card` loaded — so what
was dropped really was only the other block's rules.

**The environment form — §2.6's trap where the mover is the *runner*, not the page.** `cmp-link`'s
`link as drawn` probe pinned `iconCentreOffsetFromLabelBox: 1.3` and `linkHeight: 16`. Those are Roboto
font metrics, and `dist/theme.css` then pulled Roboto over a Google Fonts `@import` (FND-005), so they
depended on network egress at measure time. The font-dependent half was recorded `status: "unmeasured"`
with the reason inline (`compare-measurements` skips a probe whose baseline is not `measured` — the
schema's way to say "this harness cannot answer this"); the probe still *runs* and prints locally. The
font-**independent** half of the same specimen — the 4px gap and the 16×16 icon — was split out and stays
asserted. Do not re-arm an unreproducible baseline by re-baselining; that just moves the coin flip to
whoever runs CI next.

**Closed 2026-09-14 — the font is now deterministic.** Roboto is self-hosted: five `woff2` committed at
`vendor/fonts/roboto/`, declared as five `@font-face` blocks, and the gate's virtual origin
(`build/lib/virtual-origin.mjs`) maps the `/<odcThemeModule>/` prefix onto them so the authored ODC path
resolves in the harness too. No network egress decides the metrics any more, in CI or at a keyboard.

Two things follow, and the second is the one worth remembering:

1. **`cmp-link`'s font-metric half still cannot be re-armed, and the remedy first prescribed was wrong.**
   Self-hosting was tried as exactly that remedy and the probe failed CI anyway. ubuntu-latest + Chrome
   reads `{linkHeight: 16, iconCentreOffsetFromLabelBox: 1.3}` — *identical to the original baseline* —
   while Windows + Chrome reads `{17, 0.8}`, both with the same committed face and zero CDN requests. The
   earlier diagnosis — that `1.3` was an Arial artifact and "the baseline was the outlier, not the
   runner" — was backwards. The baseline was captured on the CI platform and was right for it all along;
   `0.8` is merely what Windows renders, and its match with the `0.83px` in `wf-link.css` was a
   coincidence of platform, not a confirmation.

   The real lesson is one level up from fonts: **pinning the asset does not pin the metric.** A probe
   reading rasterised geometry is sensitive to the OS text stack, not just to which face loaded, so "make
   the input deterministic" is not enough — the *measurement* has to be platform-independent. Baselining
   either number guarantees a false failure for whoever runs the other OS: the same coin flip, moved from
   the network to the kernel. Re-arming needs an assertion that survives both (the icon optically centred
   within a stated tolerance, or integers instead of 2dp floats), and **CI is the authority**, because CI
   is what blocks merges.
2. **Every baseline captured while the font was undecided is suspect, not just the unmeasured one.**
   Making the font deterministic surfaced 8 probe changes at once: four were the intended observation
   (face count 45 → 5, the `googleapis` request gone), two were a `cmp-dropdown` FontAwesome probe
   counting *every* `@font-face` on the page rather than FontAwesome's — §2.7 mis-scoping, fixed by
   scoping the count — and two were geometry baselines silently captured under **Arial** metrics, which
   read as regressions the moment the real face arrived. A gate exemption that lets the harness render a
   face the product does not ship does not avoid that cost; it defers it, and spreads it across whoever's
   PR happens to trip it. `build/gate/README.md` once argued that exemption was *safe* for exactly this
   reason. It was not.

### 2.12 The specimen page loads every block rule TWICE — a CSSOM-deletion test must delete both copies

**Cost:** an hour chasing a fix that had already landed, and a verification method that can pass for the
wrong reason.

`build/review/specimen-page.mjs` links `dist/theme.css` **and then** each `src/blocks/*.css` file (in
`src/blocks/index.css` order), and the theme **bundles those same block files**. Every block rule is
therefore live twice on the page, in two sheets, with the per-file copy later in the cascade. (This lesson
was first written when the theme's copy loaded last; by the time the preview was retired it linked the
theme first, as the specimen page does.)

Two consequences, both met on `cmp-card-checkbox-selectable`'s Block refactor:

1. **The page and the deliverable can disagree until you re-run `npm run build:theme`.** When the
   theme's copy loaded last, a correct fix looked like a no-op through three cache-busting reloads. With
   the per-file copy last the inverse happens: reload an open page after editing a block and it shows a
   fix that `dist/theme.css` — the ODC paste — does not yet contain.
   `specimen-page.mjs` refuses to assemble a page from a theme older than `tokens/` or `src/blocks/`, but
   an already-open page is not re-checked. *Rebuild the theme, and the page, before judging anything
   rendered.*
2. **A "is my probe vacuous?" test that deletes the rule from the CSSOM must delete EVERY copy.** Removing
   one leaves the other painting, the page does not move, and the test reports that the rule does not
   matter — the exact opposite of the truth. Iterate all of `document.styleSheets` and assert on the
   *count* you removed before believing the result.

The general form: **the specimen page is not a single cascade, and neither is ODC.** The rendered result
is the authority, the source file is not, and any experiment that reasons by removal has to account for
every place the declaration lives.

### 2.13 A `wf-specimen__*` class in ODC ships nothing — and a missing framework base hides real collisions

**Cost:** a shipped screen (`WrightFloodLiveStyleGuide/Property`) rendering the Select Card as a
square-boxed 71px row instead of a tile, with three independent causes, none visible in the harness.

Diagnosed live on 2026-09-15, in the published app rather than the harness:

1. **`wf-specimen__*` is harness chrome, not a deliverable.** The screen's image slot was
   `<div class="wf-preview__option-card-logo">` (today's `wf-specimen__*`), copied out of the harness
   markup. Chrome classes are defined in `build/review/specimen.css`, which is **not** part of
   `dist/theme.css`, so in ODC it matched nothing and rendered **0×0**. A class that works in the harness
   and vanishes in the product is worse than a missing class, because the markup looks right. **Handover
   markup must never contain a `wf-specimen__` class**, and a specimen that uses one for anything but
   chrome has to say so.
2. **A missing framework base makes the harness lie by omission.** In a fresh worktree the submodule is
   uninitialised and `npm run build:osui` has never run, so
   `review/vendor/outsystems-ui/outsystems-ui.css` does not exist and a page rendered without it has **no
   framework CSS at all**. Every collision with a framework rule is then invisible — two shipped defects
   in this component (a backwards checkmark, and a framework checkbox box painting over our circle)
   survived a checker-PASS for exactly that reason. `specimen-page.mjs` now refuses to assemble a page
   without the file, and `validate:theme` warns when it is missing — treat that warning as a stop, not
   noise. `npm run build:osui` is not optional setup; **it is what makes the specimen a specimen.** Even
   then it is not the whole truth: ODC also loads `OutSystemsReactWidgets`, which the submodule does not
   contain (`specs/foundations/platform.md` §9).
3. **The device rung is not an edge case.** OutSystems puts `tablet` on `<body>` at a **1024px** window,
   so the framework's `.tablet [data-checkbox] { 32px }` fires on an ordinary laptop browser. An override
   that beats a framework rule at `(0,1,0)` on the desktop rung can lose to the same framework's
   `.tablet`-scoped rule at `(0,2,0)` — and a component pinned to a drawn size silently grows by a third.
   Scope block overrides so they out-specify the device rungs, and measure at `desktop`, `.tablet`
   **and** `.phone`.

The through-line with §2.12: **the harness is not the product.** Anything the harness supplies that ODC
does not — or fails to supply that ODC does — is a defect waiting at paste time.
