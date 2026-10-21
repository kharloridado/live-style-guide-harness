# Live Style Guide — foundation pages rendered from the tokens

**Artifact kind:** Live Style Guide tooling, not a deliverable component. **Where it goes:** the
`<<LSG_MODULE>>` module.

The Styles pages (Colors, Typography, Spacing, Border radius, Border size, Shadow) are not built by
hand. Each one is a small Block around `<lsg-token-reference>`, which reads every token of one kind
from the published theme and renders it as a table: specimen, token, live value, copy button.

What that buys: **a token added, renamed or re-valued in the theme appears on the right page the
next time the theme is published.** Nobody edits the Colors page when a colour is added. The page
cannot drift from the theme, because it is the theme.

## Files

| Source | What it is |
|---|---|
| `src/lsg/lsg-token-reference.js` | the renderer: one vanilla custom element, no dependencies |
| `dist/theme.css` | the theme it reads; already pasted into `<<THEME_MODULE>>` |

## Code to paste into ODC

## How it reads the theme

- **Names** come from the page's stylesheets: every custom property declared on `:root`, `html` or
  `body` whose name starts with the kind's prefix, in declaration order. Nothing is listed in the
  script.
- **Values** come from `getComputedStyle`, so the page shows what the browser resolved, including
  OutSystems UI defaults the theme does not override.
- A stylesheet from another origin cannot be read; its tokens are skipped. The theme is served by
  the app, so this does not affect it.

| `kind` | Token prefix | Specimen |
|---|---|---|
| `color` | `--color-` (grouped by family) | swatch |
| `font-size` | `--font-size-` | sample text at that size |
| `font-weight` | `--font-` (numeric values only) | sample text at that weight |
| `space` | `--space-` | bar of that width |
| `radius` | `--border-radius-` | box with that radius |
| `border-size` | `--border-size-` | box with that border |
| `shadow` | `--shadow-` | box with that shadow |

Optional attributes: `heading`, `intro`, `filter` (a regular expression the token name must match,
e.g. `^--color-(primary|secondary)` for a Core palette), `exclude`.

## Build in ODC with Mentor Studio

## Checklist

- [ ] `dist/theme.css` is the current build and is pasted into `<<THEME_MODULE>>`.
- [ ] The Script and the seven Blocks exist in `<<LSG_MODULE>>`, each Block requiring the Script.
- [ ] Each Styles screen shows its Block, with the intro rewritten for this design system.
- [ ] Published, and checked in a real browser: Service Studio preview does not run Web Components.
- [ ] A token added to the theme appears on its page after the next publish, with no page edit.
