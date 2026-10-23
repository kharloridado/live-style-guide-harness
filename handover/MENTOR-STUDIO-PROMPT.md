# Building handovers in ODC with Mentor Studio

A prompt you paste into **ODC Mentor Studio** (the agentic assistant inside ODC Studio) to
do the OutSystems-side build of a component handover.

## What Mentor Studio does — and doesn't — here

Mentor Studio is a **logic/data agent**: it creates and modifies server actions, client
actions, service actions, aggregates, and screen/Block logic, and it explains/reviews
existing code. Effective-prompt rules from the OutSystems docs:

- **State the goal, give context, then specify details** — in that order.
- **Reference every element by name in every prompt** — Mentor doesn't detect the current
  screen or selection, so "modify the `Toast` Block" beats "modify this Block".
- **Iterate** — start broad, refine in follow-ups; don't over-stuff one prompt.

Mentor does **not** reliably author raw **Theme CSS** or hand-written **JavaScript** — and
those are exactly our handover artifacts (`dist/theme.css`, `src/blocks/*.css`,
`src/components/*.js`). So we don't ask it to. The dev pastes the CSS into the Theme editor
and imports the `.js` as the Block's Required Script **first** (see each handover's
checklist); Mentor's job is the **Block, its widgets and inputs, the lifecycle calls, and the
Client Actions** around the already-imported script.

**Structural handovers** (a Layout or shared Blocks) use a different prompt shape: target HTML, a
self-contained rule list, one prompt per module. See "Structural handovers" below.

Two OutSystems realities the prompts bake in:

- **Element ids are platform-generated.** You can't hand-type an `id` and address it from
  JS. Give the element/Block a **Name** and pass its runtime `.Id` to the helper
  (`window.<<JS_NAMESPACE>>X.show($parameters.WidgetId)` where `WidgetId = <WidgetName>.Id`). Don't add a
  string `Id` input or bind the `id` attribute.
- **Enumerable inputs are Static Entities.** Model `Type`/`Variant`/`Size`/`Position`/`Status`
  as Static Entities — one record per value, with a single Text attribute (e.g. `Value`) set
  as the record **Identifier** (delete the default Id/Label/Order/Is_Active) holding the
  literal the component expects, not free Text. The input then binds directly (e.g. `type = Type`).

> Sources: OutSystems ODC docs — *Effective prompts for Mentor*, *Prompts for Mentor
> Studio*, *Capabilities and patterns for Mentor Studio*, *Known limitations*.

---

## Structural handovers — layouts and shared Blocks

Most handovers ask Mentor to wire a Block around CSS that is already pasted. A **structural**
handover — restructuring a Layout, or app-wide Blocks such as `Menu`, `ApplicationTitle`,
`UserInfo` — needs a different kind of prompt. This is the method a real side-menu build settled on.

### 1. Start from the live DOM, not the template you expect

Open the published page and read the rendered DOM before writing anything. It is the spec of what
ODC actually emits, and it repeatedly contradicted both the vendored skills and our own specimen:

- the template wrapped the `Title` placeholder in its own `h1`, so a screen's `h1` nested inside it;
- `BreadcrumbsItem` has an `Icon` placeholder holding the "/" separator (the vendored docs list
  only `Title`);
- the `LoginInfo` Container carried Phosphor's `ph` class, which put every letter inside it in the
  icon font;
- the logo `Image` carries an inline `style="height: 32px"` that any sizing rule has to beat;
- `ApplicationTitle` had an `If`, so two instances rendered different markup.

Save the capture beside the item (`specs/<kind>/<id>/live-dom-<date>.html`) and model the specimen
on it, so the gate measures what ODC renders.

### 2. Give Mentor the target HTML, with a legend

Mentor reads HTML. For each Block, give the **target rendered HTML** and a legend that maps markup
to widgets:

| Markup | Widget |
|---|---|
| `data-block="X.Y"` | an instance of Block `Y` from module/flow `X` |
| `data-container` | Container |
| `data-advancedhtml` | HTML Element with that tag |
| `data-expression` | Expression |
| `data-link` / `data-image` | Link / Image |
| `<i class="icon ph ph-NAME">` | Icon, Phosphor `NAME` |
| `<div><!-- PLACEHOLDER Name --></div>` | Placeholder named `Name` |
| `class="…"` | the widget's Style Classes — set exactly |

Mark every line `<- ADD`, `<- MOVE here`, `<- REMOVE …` or `(unchanged)`, and add a worked example
screen that renders the per-screen parts (breadcrumbs, title, actions).

Say in the prompt: **"Build these as real widgets. Never paste this HTML into an Expression or an
HTML Element."** The target HTML is a spec, not a literal; Mentor reads HTML well enough to take the
shortcut if it is not told.

### 3. Make the prompt self-contained

**Mentor sees what is in the module, not this repository** — not the handovers, not the vendored
OutSystems Frontend Skills. Never cite a repo file, path, finding id or ref section.

The `specs/` Markdown is kept agent-readable so it can be **imported into ODC** (the theme module, or
the Live Style Guide) as Resources — context for Mentor and for anyone using the Live Style Guide or
the design system. Once a module has them and Mentor is confirmed to read them there (ask it to
summarise one by name and check the answer against the file), a prompt may name the imported
resource instead of restating it. Until then, and always for the rules a wrong build would break,
state them inline. Take the rules from
`vendor/outsystems-frontend-skills` and **state them in plain words** in an "OutSystems UI rules to
follow" list (one Layout per screen; the menu in the layout's `Navigation` placeholder; only Links
and Submenus inside `PageLinks`, never styled; the title as one `h1` in `Title`; Phosphor icons at
Font size; a menubar owns only menu items; ODC cannot omit an attribute, so never bind one to "").
Say "the Theme CSS is already in <<THEME_MODULE>>", not `dist/theme.css`.

### 4. Placeholder, Container or Text

- **Placeholder** for every slot whose content changes per screen or per app (`Navigation`,
  `HeaderTitle`, `Breadcrumbs`, `Title`, `Description`, `Actions`, `MainContent`, `Footer`,
  a `BreadcrumbsItem`'s `Icon`). Keep `placeholder-empty` in its Style Classes so an empty one
  collapses — and declare no `display` on it in CSS, or the collapse is lost.
- **Container** only for a pure layout wrapper with no content of its own.
- **Text / Expression** for app-wide chrome that is the same on every screen.

### 5. One prompt per module, run in order

Split by module, one prompt each, and say which module it runs in:

- **Prompt A — the theme module** (`project.config.json` → `modules.theme`): the reusable,
  **public** layout Block. It bakes the design-system class into the OutSystems UI layout wrapper's
  `ExtendedClass` (`"<<CLASS_PREFIX>>side-menu " + ExtendedClass`) so screens set nothing, copies the generic template Blocks it
  needs (e.g. `MenuIcon`), and exposes a placeholder for anything app-specific (e.g. `HeaderTitle`).
  It references **no consumer Block**.
- **Prompt B — the consumer app**: the `Common` Blocks (`Menu`, `ApplicationTitle`, `UserInfo`) and
  the screens, which use the theme's layout and fill its placeholders. It leaves the app's old
  layout in place, unused, rather than deleting it.

In `handover/handover-map.json`, give the entry `mentor.prompts: [{ title, text }, …]` instead of
`mentor.text`; `npm run embed:handover` renders each as its own subsection under "Build in ODC with
Mentor Studio". Order: paste the theme CSS → Prompt A → Prompt B.

### 6. Rules learned the hard way

- **Never move a widget inside a shared Block** that other layouts host. Moving `ApplicationTitle`
  out of `PageLinks` shifted every top-menu header. Add a second instance where the new layout needs
  it and switch them with CSS scoped to the layout; then measure the other layouts.
- **Write "every branch"** when a Block has an `If`, or Mentor builds the new markup into one branch
  only.
- **Say what not to touch, with the reason.** Mentor turned on `EnableAccessibilityFeatures` despite
  the plain instruction to leave it; it switches OutSystems UI's accessibility mode on, which
  changes ruled focus and hover styles in inputs, dropdowns, buttons and checkboxes. Never ask for
  a framework-wide switch to get one local behaviour — scope the behaviour in CSS instead.
- **Use fixed strings or `If(…, "page", "false")` for attributes** — never `""`.
- **End every prompt** with "list every widget you added, moved or deleted, by Block and Name, and
  flag anything you could not build exactly as the target HTML shows".

### 7. Verify on the published page, then send a delta

After Mentor runs, measure the published page — computed styles and boxes against the item's probe
values — at desktop and at tablet. Do not judge by eye. Check first that the pasted theme is the
current build: a stale stylesheet once drew the breadcrumb separator twice ("//"). Fix deviations
with a **short follow-up prompt** scoped to one Block: numbered steps, then a `Result:` snippet of
the target HTML, then "No CSS, no JavaScript, no other changes. List what you changed."

---

## Widget libraries — slots first, widgets last

Mentor cannot add a dependency on a `WidgetLibrary` asset ("An internal error occurred while
referencing producer") and cannot open an app revision that has one. A handover for screens that
use a widget library's widgets is therefore two steps, in this order:

1. **The Mentor prompt**, run on a revision **without** the dependency, builds everything else and
   leaves a **slot** where each widget goes: a Container named `Slot_<Purpose>`, Style Classes
   `<prefix>slot`, holding one Text that names the widget and every binding —
   `ReactAria Switch · Label "Is pending" · Is selected = ExampleIsPending`. Every variable and
   action a slot names is created in the same prompt. For many screens, attach one spec file per
   batch (5–7 screens, at most 14 KB; `npm run widgets:pages` writes them) and publish after each.
2. **The Studio step.** Add the dependency once (Manage Dependencies → the library → all widgets →
   Apply), then for each slot: delete its Text, drop the widget into the Container, set exactly
   what the text says. **The slot text is the checklist** (`specs/widget-library/widget-slots.md`
   lists them all). Publish per screen. An enum property of a library widget cannot be bound, so
   an example that switches one has a slot per value, each with a Visible condition.

After the Studio step the app is changed in Studio, or through Mentor from the last revision
without the dependency — which then has to be told explicitly to publish over the newer
revisions, losing the placed widgets, and step 2 runs again.

---

## L5 — a custom Block with a required Script (the default)

A component OutSystems UI does not ship is an OutSystems Block: widgets, placeholders and typed
input parameters, styled by the theme, plus one Script the Block requires for behaviour. Its
handover has a `## The Block` section — inputs, placeholders, events, the widget tree with Style
Classes, the named widget the script works on, and the three lifecycle calls — and its map entry
names the JS destination as the Block's **Required Script**. `npm run embed:handover` then derives
the prompt: Static Entities first, the Block interface, the widget tree, `Raise<Event>` actions,
then OnReady (`init`), OnParametersChanged (`update`) and OnDestroy (`destroy`), each a "Run
JavaScript" node keyed by the named widget's `.Id`. `handover/lsg-foundations.md` is a worked
example.
