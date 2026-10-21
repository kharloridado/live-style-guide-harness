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

Mentor does **not** reliably author raw **Theme CSS** or custom **vanilla-JS Web
Components** — and those are exactly our handover artifacts (`dist/theme.css`,
`src/blocks/*.css`, `src/components/*.js`). So we don't ask it to. The dev pastes the CSS
into the Theme editor and imports the `.js` as a Script resource **first** (see each
handover's checklist); Mentor's job is the **Block wrapper, attribute bindings, event
wiring, and the Client Actions** that drive the already-pasted component.

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

## A) Reusable template (fill the `<<…>>` blanks)

```
Goal: In ODC Studio, wire up an OutSystems Block that wraps the already-imported
custom Web Component <<<<CLASS_PREFIX>>COMPONENT>> for the <<DESIGN_SYSTEM_NAME>> design system.

Context (already done manually — do NOT re-create or edit these):
- The brand Theme CSS (dist/theme.css) and any block CSS are already pasted into the
  ODC Theme editor.
- The Web Component script <<<<CLASS_PREFIX>>COMPONENT.js>> is already imported as a Script
  resource on the Theme/Library, Include = <<Always | When invoked>>. It defines the
  custom element <<<<CLASS_PREFIX>>COMPONENT>> and a global helper <<window.<<JS_NAMESPACE>>COMPONENT>>.
- Do not write CSS, do not author or modify JavaScript, and do not edit the Theme.
  Your job is only the Block, its public interface, the attribute bindings, the event
  wiring, and the Client Action(s) that drive the component.

Task — create these elements, referencing every element by the exact name given:

1. Create a Block named "<<COMPONENT>>" with these input parameters:
   <<Name : DataType : Default — one per line, e.g.
     Type : <<EntityName>> (Static Entity) : <<EntityName>>.<<DefaultRecord>>
     Title : Text : ""
     Message : Text : ""
     Dismissible : Boolean : True
     Duration : Integer : 0 >>
   and these Block events (handlers): <<OnAction, OnDismiss>>.
   Model enumerable inputs (type / variant / size / position / status) as **Static Entities**
   — one record per allowed value, with a **single Text attribute (e.g. `Value`) set as the
   record Identifier** (delete the default Id/Label/Order/Is_Active), holding the literal the
   Web Component expects — NOT free Text. Do **not** add a string `Id` input or set the
   element's `id`: OutSystems generates element ids at runtime (see step 4 for addressing).

2. In the Block, place an HTML element <<<<CLASS_PREFIX>>COMPONENT>>. On it, set one attribute per
   Block input using a Value expression (ODC requires an expression on every attribute):
   <<  type        = Type            // Static-Entity input binds directly (Value is the identifier)
       title       = Title
       message     = Message
       dismissible = If(Dismissible, "true", "false")   // value-aware boolean, not presence
       duration    = Duration  >>
   Static-Entity inputs bind directly (e.g. `type = Type`) since their `Value` attribute is
   the identifier; use the If(flag,"true","false") form for every Boolean. Do not bind `id`.

3. Wire the component's CustomEvents to the Block events:
   <<  "action"  CustomEvent  -> trigger OnAction
       "dismiss" CustomEvent  -> trigger OnDismiss  >>
   A JavaScript node cannot raise a Block event directly — `$actions` reaches Client Actions,
   and only a Trigger Event node raises an event. So first create one Client Action **on the
   Block** per event, each a single Trigger Event node: <<"RaiseOnAction", "RaiseOnDismiss">>.
   Do NOT use the declarative "Handle Events" path (unreliable for custom elements). Instead add
   a "Run JavaScript" node in the Block's **OnReady** that addEventListener's each CustomEvent
   (keeping the handlers on the element itself) and calls the matching Raise action, and a
   second "Run JavaScript" node in **OnDestroy** that looks the element up again by `WidgetId`
   and removeEventListener's them. Store nothing on `$public` — it is one shared object, not
   one per Block instance, and a second instance would lose its events. Each handover ships the
   exact OnReady + OnDestroy code in its "## Event wiring (OnReady / OnDestroy)" section —
   paste it verbatim (placement, not authoring).

4. To address a specific instance, give the <<<<CLASS_PREFIX>>COMPONENT>> element (or its Block) a
   **Name**, then create a client action "<<Show COMPONENT>>" with a "Run JavaScript" node
   whose `WidgetId` input is the widget's **platform-generated** `.Id` (e.g. `<<MyWidget>>.Id`)
   — never a hand-typed string:
   <<  window.<<JS_NAMESPACE>>COMPONENT.show($parameters.WidgetId);  >>
   Add sibling client actions for any other helper methods (<<hide, toggle>>) the same way.

Constraints / fidelity rules (must hold):
- Never edit the OutSystems UI module; build only on top.
- Do not hard-code colors/sizes anywhere — all styling already comes from var(--token)
  in the pasted Theme; you are not adding styles.
- Apply variants on native widgets via Extended Class only (e.g. ExtendedClass =
  "btn-ghost"); never mutate OutSystems UI internals. (N/A for pure Web Components.)
- After generating, list exactly which elements you created/modified by name, and list
  any step you could NOT do so I can finish it manually.

Work iteratively: do step 1 first and show me the Block interface before wiring events.
```

**How to drive it:** paste the filled template, let Mentor create the Block interface,
confirm, then continue with steps 2–4. Always name elements explicitly. Treat it as a
conversation, not one shot.

---

## B) Worked example — `<<CLASS_PREFIX>>toast`

Filled from [`handover/<<CLASS_PREFIX>>toast.md`](<<CLASS_PREFIX>>toast.md).

```
Goal: In ODC Studio, wire up an OutSystems Block that wraps the already-imported custom
Web Component <<<CLASS_PREFIX>>toast> for the <<DESIGN_SYSTEM_NAME>> design system (transient toast
notification at a configurable screen position).

Context (already done manually — do NOT re-create or edit these):
- dist/theme.css (brand + component tokens, incl. --<<CLASS_PREFIX>>toast-*) is already pasted into
  the ODC Theme editor.
- <<CLASS_PREFIX>>toast.js is already imported as a Script resource on the Theme/Library, Include =
  Always. It defines the custom element <<<CLASS_PREFIX>>toast> and the global helper window.<<JS_NAMESPACE>>Toast
  with methods show(idOrEl, opts), hide(idOrEl), toggle(idOrEl, force).
- Do NOT write CSS, do NOT author or modify JavaScript, do NOT edit the Theme. Your job is
  only the Block, its inputs/events, the attribute bindings, the event wiring, and the
  Client Actions that drive the toast.

Task — create these elements, referencing each by the exact name given:

1. Create a Block named "Toast" with input parameters:
     Type        : ToastType (Static Entity)     : ToastType.Default
     Position    : ToastPosition (Static Entity) : ToastPosition.Bottom
     Title       : Text                          : ""
     Message     : Text                          : ""
     ButtonLabel : Text                          : ""
     ButtonHref  : Text                          : ""
     Dismissible : Boolean                       : True
     Duration    : Integer                       : 5000
   and Block events: OnAction, OnDismiss.
   Static Entities — create these first. Give each a single Text attribute "Value" set as the
   record Identifier (delete the default Id/Label/Order/Is_Active); each record's value is the
   literal the Web Component expects, so model Type/Position as the entity, NOT free Text:
   - ToastType: Default="default", Success="success", Warning="warning", Error="error", Information="information"
   - ToastPosition: Bottom="bottom", Top="top", BottomLeft="bottom-left", BottomRight="bottom-right", TopLeft="top-left", TopRight="top-right"
   Do NOT add a string Id input or set the element's id — OutSystems generates ids at runtime.

2. In the Block, place an HTML element <<<CLASS_PREFIX>>toast>. Set one attribute per input via a
   Value expression:
     type         = Type
     position     = Position
     title        = Title
     message      = Message
     button-label = ButtonLabel
     button-href  = ButtonHref
     dismissible  = If(Dismissible, "true", "false")
     duration     = Duration
   Static-Entity inputs bind directly (type = Type, position = Position) — the Value attribute
   is the identifier. Use the If(flag,"true","false") form for the Boolean (values, not presence).

3. Wire CustomEvents to Block events: the element's "action" CustomEvent triggers OnAction,
   and its "dismiss" CustomEvent triggers OnDismiss. First create two Client Actions on the
   Block, each a single Trigger Event node — "RaiseOnAction" → OnAction and "RaiseOnDismiss"
   → OnDismiss — because a JavaScript node's $actions reaches Client Actions, not Block
   events. Then wire the Block's **OnReady** (a "Run JavaScript" node that addEventListener's
   both events on the <<<CLASS_PREFIX>>toast> element, keeping the handlers on the element, and calls the
   Raise actions) and clean up in **OnDestroy** (a second "Run JavaScript" node that finds the
   element again by WidgetId and removeEventListener's them) — not via the declarative
   "Handle Events" path. Store nothing on $public; it is shared by every Block instance. Paste
   the verbatim code from the handover's "## Event wiring (OnReady / OnDestroy)" section.

4. OutSystems generates element ids at runtime, so address a specific toast by its widget's
   platform .Id — not a hand-typed string. Give the <<<CLASS_PREFIX>>toast> element (or its Block) a
   Name, then create client actions whose "Run JavaScript" node takes a WidgetId input set to
   <thatWidgetName>.Id and calls the helper:
     - "ShowToast":   window.<<JS_NAMESPACE>>Toast.show($parameters.WidgetId);
     - "HideToast":   window.<<JS_NAMESPACE>>Toast.hide($parameters.WidgetId);
     - "ToggleToast": window.<<JS_NAMESPACE>>Toast.toggle($parameters.WidgetId);

Constraints:
- Never edit the OutSystems UI module; no hard-coded colors/sizes (styling already comes
  from var(--token) in the Theme); you add no CSS.
- After generating, list every element you created by name, and flag any step you could
  not complete so I can finish it manually.

Start by creating the Block "Toast" with the inputs and events in step 1, then show me the
interface before we wire the bindings and events.
```

After Mentor finishes: **1-Click Publish and validate in a real browser** at phone/tablet/
desktop (Service Studio Preview does not run Web Components) — test all five `type`s, both
layouts, and all positions, per the handover checklist.
