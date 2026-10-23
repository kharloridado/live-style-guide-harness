# specs/widget-library/ — a Live Style Guide for a widget library

Only for a project whose Live Style Guide documents an **osfe widget library** (a `WidgetLibrary`
asset) — one docs page per widget, like a component library's public docs — instead of Blocks.
`project.config.json` → `widgetLibrary` names the asset and its source folder; with it `null`,
this folder stays empty.

The plugin's `outsystems-style-guide-doc` → `references/page-spec.md` § C is the page spec, and
`outsystems-mentor-build` → "Widget libraries" is why the build runs **slots first, widgets last**:
Mentor cannot reference a widget library or open an app that does.

## Files

| File | Written by | What it is |
|---|---|---|
| `library.json` | hand | Categories and their widgets, in menu order; the sample-data map; the root-class and docs-URL patterns; properties to leave out of examples; widgets whose page is built by hand |
| `content.json` | hand | Per widget: `lead`, `usage`, `a11y`, `keyboard` (`[keys, action]` rows), `states` (selectors), and the example's `data`, `defaults`, `texts`, `placeholders`, `extraSlots`, `extraActions` |
| `pages/00-foundation.md` | hand | The data model, the shared blocks (`WidgetReference`, the table of contents, the tables) and the shell's accessibility. Build it before any widget page |
| `catalogue.json` | `npm run widgets:catalogue` | The static-entity records: categories, widgets with their docs text, every property row read from the code, keyboard rows, state selectors |
| `pages/NN-<category>.md` | `npm run widgets:pages` | One screen spec per widget, one file per category. Each file is one Mentor turn: attach it, build that batch, publish |
| `widget-slots.md` | `npm run widgets:pages` | The Studio checklist: every slot, with the widget and bindings that go in it |

Never edit a generated file; change `library.json`, `content.json` or the widget, and regenerate.

## Rules the generators enforce

- **The API is read from the code.** Each property's Studio name, description, type, default and
  kind come from the widget's `NamedProperty` declarations, so the tables cannot drift. Needs
  TypeScript's JavaScript API (typescript 5; the library's own install is used when it has one).
- **Sample data goes through one explicit map.** `library.json` → `samples` maps each source in
  `content.json` (`"Fruits"`) to its static entity and aggregate (`SampleFruit`,
  `GetSampleFruits`). An unmapped source fails the build; nothing is inflected from a plural.
- **Default Values are literals.** A computed initial value (`AddDays(CurrDate(), 3)`) is written as
  "(set in OnInitialize)" with an OnInitialize assignment; `CurrDate()`, numbers, strings, booleans
  and `#…#` date literals stay as defaults.
- **One batch is at most 7 screens and 14 KB.** A bigger category file is printed as a warning:
  split the category, or send it in two turns.
- **Seeds over 150 records** are noted, so the prompt asks Mentor to seed them in batches.

## The build, in order

1. `npm run widgets:catalogue` and `npm run widgets:pages`.
2. Mentor, on a revision **without** the widget-library dependency: the foundation
   (`pages/00-foundation.md` + `catalogue.json`), then one turn per category file, each publishing
   on its own. After each publish, run `build/gate/probe-pages.js` on the batch's pages.
3. Studio: add the dependency and fill the slots from `widget-slots.md`.
4. After that the app changes in Studio, or through Mentor from the last revision without the
   dependency, published over the Studio revisions (step 3 again).

A worked example, built this way: React Aria Docs, in
[`kharloridado/os-react-aria`](https://github.com/kharloridado/os-react-aria) → `style-guide/`.
