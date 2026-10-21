# Live Style Guide — foundation pages rendered from the tokens

**Artifact kind:** Live Style Guide tooling, not a deliverable component. **Where it goes:** the
`<<LSG_MODULE>>` module.

The Styles pages (Colors, Typography, Spacing, Border radius, Border size, Shadow) are not built by
hand. Each one places a **TokenReference** Block, which reads every token of one kind from the
published theme and renders it as a table: specimen, token, live value, copy button.

What that buys: **a token added, renamed or re-valued in the theme appears on the right page the
next time the theme is published.** Nobody edits the Colors page when a colour is added. The page
cannot drift from the theme, because it is the theme.

## Files

| Source | What it is |
|---|---|
| `src/lsg/lsg-token-reference.js` | the script: `LsgTokenReference.init / update / refresh / destroy`, no dependencies |
| `src/lsg/lsg-token-reference.css` | the Block's styles, tokens only |
| `dist/theme.css` | the theme it reads; already pasted into `<<THEME_MODULE>>` |

## Code to paste into ODC

## The Block

One Block, **TokenReference**, used once per foundation.

| | |
|---|---|
| Input `Kind` | `TokenKind` Identifier, mandatory: which tokens to list |
| Input `Heading` | Text, optional: the section heading; none when empty |
| Input `Filter` | Text, optional: a regular expression a token name must match, e.g. `^--color-(primary\|secondary)` for a Core palette |
| Input `Exclude` | Text, optional: a regular expression a token name must not match |
| Placeholder `Intro` | the page's intro or brand narrative, above the table |
| Required Script | `LsgTokenReference` |
| Style sheet | `lsg-token-reference.css` |

Widget tree:

```
Container  Root       Style Classes "lsg-token-ref"
├─ If Heading <> ""   → HTML Element h2, Style Classes "lsg-token-ref__heading", text = Heading
├─ Container          Style Classes "lsg-token-ref__intro"
│  └─ Placeholder Intro
└─ Container  Body    (empty — the script renders the table here)
```

Lifecycle — each a Client Action with one "Run JavaScript" node whose inputs are `WidgetId` =
`Body.Id`, `Kind`, `Filter` and `Exclude`:

```js
// OnReady
LsgTokenReference.init($parameters.WidgetId, { kind: $parameters.Kind, filter: $parameters.Filter, exclude: $parameters.Exclude });
```

```js
// OnParametersChanged
LsgTokenReference.update($parameters.WidgetId, { kind: $parameters.Kind, filter: $parameters.Filter, exclude: $parameters.Exclude });
```

```js
// OnDestroy (WidgetId only)
LsgTokenReference.destroy($parameters.WidgetId);
```

Each instance is keyed by its own `Body.Id`, so several on one screen do not interfere, and a
second `init` for the same instance re-renders instead of binding twice.

## How it reads the theme

- **Names** come from the page's stylesheets: every custom property declared on `:root`, `html` or
  `body` whose name starts with the kind's prefix, in declaration order. Nothing is listed in the
  script.
- **Values** come from `getComputedStyle`, so the page shows what the browser resolved, including
  OutSystems UI defaults the theme does not override.
- A stylesheet from another origin cannot be read; its tokens are skipped. The theme is served by
  the app, so this does not affect it.

| `TokenKind` | Value | Token prefix | Specimen |
|---|---|---|---|
| Color | `color` | `--color-` (grouped by family) | swatch |
| FontSize | `font-size` | `--font-size-` | sample text at that size |
| FontWeight | `font-weight` | `--font-` (numeric values only) | sample text at that weight |
| Space | `space` | `--space-` | bar of that width |
| Radius | `radius` | `--border-radius-` | box with that radius |
| BorderSize | `border-size` | `--border-size-` | box with that border |
| Shadow | `shadow` | `--shadow-` | box with that shadow |

## Build in ODC with Mentor Studio

## Checklist

- [ ] `dist/theme.css` is the current build and is pasted into `<<THEME_MODULE>>`.
- [ ] `<<LSG_MODULE>>` has the Script `LsgTokenReference`, the Static Entity `TokenKind` and the
      Block `TokenReference`, with the CSS in the Block's style sheet and the Script required.
- [ ] Each Styles screen places `TokenReference` with its `Kind`, and its intro in `Intro`.
- [ ] Published, and checked in a real browser: Service Studio preview does not run the script.
- [ ] A token added to the theme appears on its page after the next publish, with no page edit.
