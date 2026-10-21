# Platform — OutSystems UI and ODC

How the host platform constrains every build, and this project's ODC environment.

## OutSystems and ODC rules

Behaviours of the host platform that contradict what a competent web developer would reasonably
assume, and the build discipline they force. They do not announce themselves; they present as "the
component is mysteriously broken". Each rule carries the failure that put it here — nothing below is
speculative.

### 1. Parse boolean attributes by value — never test them with `hasAttribute()`

When a Web Component is wrapped in a Block, the platform binds each attribute from an expression, and
the idiomatic binding is `If(Flag, "true", "false")`. The attribute is therefore **always present in
the DOM** — as the literal string `"false"` when the flag is off. A component that tests presence
(`hasAttribute("dismissible")`, or a bare `dismissible` check) sees the feature as permanently on and
can never be switched off from the platform side.

Read every boolean through one value-aware helper:

```js
_boolAttr(name, fallback = false) {
  if (!this.hasAttribute(name)) return fallback;
  const v = (this.getAttribute(name) || "").trim().toLowerCase();
  return v !== "false" && v !== "0" && v !== "";
}
```

**Why:** a component shipped with a "dismissible" flag that could not be turned off — the attribute
was present with value `"false"` and the component only checked presence.

### 2. Never hand-type an element id — bind the widget's runtime `.Id`

The platform mangles ids at compile time. An id you see in the browser inspector is not stable across
publishes, and one you invent in JS or CSS will not match the rendered widget. When a component or
script must point at a widget, pass the widget's **runtime `.Id`** through an input parameter. The same
goes for `for` / `aria-labelledby` / `aria-controls` wiring: bind the runtime id, never a typed string.

**Why:** hand-typed ids in a handover worked in the local harness and silently pointed at nothing once
published.

### 3. Type enumerable Block inputs as Static Entities, not free Text

A Block input that takes one of a fixed set of values (size, variant, tone, placement) is a **Static
Entity**, not `Text`. Free text gives the consuming developer no autocomplete, no compile-time check and
no discoverability, and it no-ops silently when someone types `"Regular"` where the CSS expects
`"regular"`. Enumerate it and the platform validates it for you.

**Why:** size and variant inputs typed as `Text` rendered the base style, with no error, whenever the
string did not match exactly.

### 4. Never let a border resize a component — paint edges with an inset `box-shadow` or `outline`

A 1px border adds 2px of height. A component with a pinned height and a real `border` is 2px taller
than its spec, and one that grows a border on hover or focus jumps by 2px. Both are fidelity failures
and both are easy to miss in a static screenshot. Any edge that appears, changes width, or changes on
state is an **inset `box-shadow`** or an **`outline`** — they paint without taking part in layout — and
the component's height is pinned explicitly.

**Why:** a status badge was 2px taller than the mockup at every size, traced to a genuine 1px border
where the design intended a painted edge.

### 5. Never select on a framework runtime utility class — target elements structurally

Frameworks ship classes that their **JavaScript** adds and removes at runtime to signal state (the
canonical example is a `.placeholder-empty`-style class stamped on empty placeholders). They are
behavioural markers, not styling hooks: they come and go on conditions you do not control, and the
framework may change their meaning in a minor release. Target elements **structurally**, by their real
role in the DOM.

Corollary: empty placeholders are already zero-size. There is nothing to collapse — do not write CSS to
collapse them.

**Why:** one selector keyed on the framework's empty-placeholder class removed every native breadcrumb
separator across the application, because the class sat on elements that were not, in any design
sense, "empty".

### 6. Use the framework's device classes, not your own `@media` breakpoints

The framework has its own responsive breakpoints and its own view of where tablet and phone begin. Raw
`@media (max-width: …)` rules will disagree with it somewhere, and the disagreement zone is where the
layout looks broken. Use the framework's device classes (`.tablet` / `.phone` on `<body>`), which it
applies consistently across every widget you sit on top of.

**Why:** hand-rolled breakpoints in a layout override desynchronised from the framework's navigation
collapse, leaving a window width at which the desktop and mobile navigation both showed.

### 7. Leave `@font-face` src paths alone — ODC rewrites them, and a 404 on the authored path is expected

Fonts referenced from theme CSS have their URLs rewritten and fingerprinted by the platform build. The
path you author is **not** the path that ships, so fetching the literal authored path and getting a 404
is not evidence of a bug — and "fixing" the path breaks the rewrite. (The review harness resolves the
same authored path without changing it: `build/lib/virtual-origin.mjs` maps the `/<odcThemeModule>/`
prefix onto the committed faces, so `dist/theme.css` stays byte-identical to the ODC paste.)

If text renders in a fallback face — classically a serif where the brand sans is expected — the cause is
almost always a **missing `@font-face` declaration**: a weight or style in use that was never declared.
Check the declared faces against the weights actually used before touching a URL.

**Why:** a serif fallback was diagnosed as a broken font path, and the "fix" — rewriting the `src` — made
it worse. The real cause was an undeclared 500-weight face.

### 8. Restyle the framework's own widget first — build a Web Component only as the last resort

The escalation order is: use the framework widget as-is → configure it → **override its own classes**
(`.btn`, `.card`, `.dropdown`, the switch, the text field) through `ExtendedClass` → and only when the
framework genuinely has no widget for the thing, build a vanilla JS Web Component. Never build a
parallel `<<CLASS_PREFIX>>button` / `<<CLASS_PREFIX>>card` system beside the framework's own: it inherits none of the framework's
accessibility, state handling or form integration, and every consuming developer has to be told which
one to use.

Colour and typography utilities follow the same rule: override the framework's existing bare utility
classes, and introduce a `<<CLASS_PREFIX>>` class only for a role the framework genuinely lacks.

Block overrides are delivered as `src/blocks/*.css`, registered in `src/blocks/index.css`. Specimen
pages link every file in `src/blocks/index.css` automatically; a block missing from that manifest is
missing from ODC too.

**Why:** a from-scratch button system, a from-scratch card system and a from-scratch set of colour
utility classes were all built, reviewed, and then **reversed** — each replaced by an override of the
framework's own class. Three components' worth of work, spent twice.

### 9. Anchor every restyle on the framework's real structure — the frontend-skills pack first, the SCSS for intent

`vendor/outsystems-frontend-skills/` is OutSystems' own reference for what the platform renders: start at
`ui-frameworks/outsystems-ui/SKILL.md`, which routes to `blocks-index.md` (blocks, arguments,
placeholders, events), `patterns/*.md` (each pattern's structure and classes), `extensibility.md`
(provider configs and JS APIs) and `styles-and-utilities.md` (CSS variables and utility classes).
Read the pattern there before writing an override. `vendor/outsystems-ui/` is the framework's
*source*: use it to understand why a widget is styled as it is, so the override cooperates with the
framework instead of fighting it. When the two disagree, publish the widget and inspect it in a real
browser — the rendered page decides — and put that markup in the item's `specimen.html`, so the gate
measures the real structure.

For each widget, know:

- every class the platform puts on it — the framework's own, the shared Feature classes, and any
  provider classes;
- each **state** you need to style — default, hover, focus, disabled, error, open/closed;
- anything the platform sets **inline** (an inline custom property beats your stylesheet and is
  invisible in the SCSS);
- the **provider** markup when a widget delegates to one — the provider's DOM is the one you are
  actually styling.

The traps, all hit on this project:

- **Styling can live in a shared "Feature" class**, not on the element you expect. The painted element
  may be a balloon/overlay class shared by several widgets rather than the inner element you were aiming
  at. Style the element that is actually painted.
- **Providers emit their own placement vocabulary.** A third-party dropdown, date-picker or tooltip
  provider emits placement classes in its own terms (`bottom-start`, not `.bottom`). Match the
  provider's vocabulary, or the rule never matches.
- **Arrows and overlays are often JS-positioned.** Do not re-implement geometry the provider computes at
  runtime (a rotated-square arrow, an offset popover). Restyle it; do not relocate it.
- **Inline custom-property declarations beat your stylesheet.** If the provider or framework writes
  `style="--x: …"` on the element, no stylesheet specificity wins. Override the property at the same or
  a more specific inline-reachable scope, or accept the value.
- **Provider CSS is often injected at high specificity** (or as an injected `<style>` block). Beating it
  legitimately takes `!important` on the handful of declarations it owns. That is not a smell here; it is
  the only lever. Keep it narrow and comment why.
- **Published ODC pages load a stylesheet neither vendored source contains: `OutSystemsReactWidgets`.**
  It declares its own `[data-checkbox]::before` (`display: table`, full size, a `#bdc5c7` background,
  `opacity: 0 → 1` on `:checked`). It sits below OutSystems UI and the theme in the cascade, so our
  declarations win, but it is live on every page — see `build/gate/LESSONS.md` §2.13.
- **The platform wraps the Checkbox input in a bare `<span>` and gives it `class="checkbox"` as well as
  `data-checkbox`.** The span breaks any layout that assumes the input is a direct flex child;
  a restyle is safe only when it positions the input absolutely or selects it as a descendant.

**Why:** restyles written against the vendored SCSS alone produced a doubled tooltip bubble, a
mispositioned arrow and a pile of dead rules that matched nothing — each obvious the moment someone
looked at the rendered element — and a multi-select restyle rendered wrong three times running, each
time because it was written against the SCSS rather than the DOM the provider actually produced.

## This project's ODC environment

Fill in at kickoff (`/lsg:project-setup` asks for it). The tenant itself is
`odcTenant` in `project.config.json`; `.mcp.json` must name the same tenant, and
`npm run check:config` fails if they drift.

| Module / app | Role |
|---|---|
| `<<ODC_THEME_MODULE>>` | The theme module. `dist/theme.css` is pasted here; self-hosted font paths resolve against it. |
| _Live Style Guide module_ | Where style-guide pages render; publish a widget here to inspect what ODC really renders. |
| _Sandbox app_ | For trying widgets and Web Components before a handover is written. |

## OutSystems UI version

Pin `vendor/outsystems-ui` to the version the target ODC environment actually runs, and record
it here with the date it was confirmed. Every restyle is designed against the framework's real
DOM and SCSS; a pin that does not match the environment designs against markup it never produces.
The submodule is read-only (hard rule 1).

- Pinned version: _TBD_
- Confirmed against the target environment on: _TBD_
