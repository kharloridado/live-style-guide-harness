#!/usr/bin/env node
/* embed-handover-code.mjs — keep each handover ticket self-contained.
 *
 * Handover tickets are filed as GitHub Tasks (body = handover/<artifact>.md) so the
 * developer can add the code into ODC. Two generated sections are kept in sync from
 * source by this script (idempotent — re-run after editing a source file):
 *
 *   "## Code to paste into ODC"          — verbatim file contents in a collapsed <details>
 *                                          (project rule: the ticket CONTAINS the JS/CSS,
 *                                          it doesn't just point at a repo path).
 *   "## Build in ODC with Mentor Studio" — a ready-to-paste prompt for ODC Mentor Studio
 *                                          that scaffolds the OutSystems side (Block,
 *                                          attribute bindings, event wiring, Client
 *                                          Actions). See handover/MENTOR-STUDIO-PROMPT.md.
 *
 * On O11 (`environment` in project.config.json) the same sections are headed "… into Service
 * Studio" and "## Build in Service Studio", and the prompt becomes steps for a developer.
 * Every prompt names the module it runs in, from `modules`.
 *
 * A MAP entry is either `[[file, lang, dest], …]` (files only) or
 * `{ files: [[…]], mentor: { … } }` to override the auto-derived Mentor prompt with a
 * fully-filled one. When `mentor` is absent the prompt is derived from the artifact kind
 * (custom Block with a required Script / Web Component / native-widget restyle / Style-Guide
 * reference). A JS file whose destination names a "Required Script" is a custom Block's.
 *
 * `mentor: { text: "…" }` is the escape hatch: the prompt is taken VERBATIM from the map.
 * `mentor: { prompts: [{ title, text }, …] }` renders several verbatim prompts, one subsection each,
 * for a change that spans modules (the theme module first, then each consumer app).
 * Use it for a component that fits none of the derived archetypes (e.g. a hand-built Block of
 * native widgets with inputs, events and a Client Action).
 *
 * Usage: node build/embed-handover-code.mjs */
import { readFileSync, writeFileSync } from "node:fs";
import { join, basename } from "node:path";
import { moduleName, projectConfig, root } from "./lib/project-config.mjs";

const cfg = projectConfig();
const DS = `${cfg.customer} "${cfg.designSystemName}"`;   // e.g. Acme Corp "Nimbus"
const NS = cfg.jsNamespace;                                // e.g. Nimbus -> window.NimbusToast
const P  = cfg.classPrefix;                                // e.g. nimbus-
const handoverDir = join(root, "handover");
const O11 = (cfg.environment ?? "ODC") === "O11";
const PATTERNS = moduleName("patterns") ?? moduleName("theme");
const LSG = moduleName("liveStyleGuide") ?? "the Live Style Guide";
/* O11 has no Mentor Studio: the same steps are rendered for a developer in Service Studio. A section
 * is found by either platform's heading, so switching `environment` re-renders it in place. */
const CODE_MARKERS = ["## Code to paste into ODC", "## Code to paste into Service Studio"];
const BUILD_MARKERS = ["## Build in ODC with Mentor Studio", "## Build in Service Studio"];
const MARKER = CODE_MARKERS[O11 ? 1 : 0];
const WIRING_MARKER = "## Event wiring (OnReady / OnDestroy)";
const MENTOR_MARKER = BUILD_MARKERS[O11 ? 1 : 0];

/* handover/handover-map.json: md file → the artifact(s) a developer places into ODC, plus an
 * optional `mentor` spec. Tokens travel via dist/theme.css, so they are not listed. */
const MAP = JSON.parse(readFileSync(join(handoverDir, "handover-map.json"), "utf8"));

/* ── "## Code to paste into ODC" ─────────────────────────────────────────────── */
function section(artifacts) {
  const blocks = artifacts.map(([rel, lang, dest]) => {
    let code;
    try { code = readFileSync(join(root, rel), "utf8").replace(/\s+$/, ""); }
    catch { throw new Error(`missing source: ${rel}`); }
    const file = basename(rel);
    return [
      `<details>`,
      `<summary><code>${file}</code> → ${dest}</summary>`,
      ``,
      "```" + lang,
      code,
      "```",
      ``,
      `</details>`,
    ].join("\n");
  });
  return [
    MARKER,
    ``,
    `> Copy the code below straight into ${O11 ? "Service Studio" : "ODC"}. The canonical source is the repo path in the` +
      ` summary — these blocks are generated from it (\`node build/embed-handover-code.mjs\`),` +
      ` so re-run after editing the source to keep the ticket in sync.`,
    ``,
    ...blocks,
  ].join("\n");
}

/* ── "## Event wiring (OnReady / OnDestroy)" ─────────────────────────────────── */
/* Resolve { tag, customEvents } for a component that dispatches CustomEvents. Source is the
 * full `mentor` spec (when it carries tag + customEvents) or a lightweight `wiring` field;
 * null for components that emit nothing (references, restyles) so no section is generated. */
function wiringOf(entry) {
  const m = entry.mentor;
  if (m && m.tag && m.customEvents) return { tag: m.tag, customEvents: m.customEvents };
  if (entry.wiring && entry.wiring.tag && entry.wiring.customEvents) return entry.wiring;
  return null;
}

// "OnChange" → "RaiseOnChange": the Block Client Action whose one Trigger Event node raises it.
function raiseName(blockEvent) {
  return "Raise" + blockEvent;
}

// A Raise action carries the event's argument as one input, named by the optional 4th tuple
// element (default "Value"); an event with no detailArg has no input.
function raiseParam([, , detail, param]) {
  return detail ? (param || "Value") : null;
}

// "acme-" → "__acmeHandlers"; hyphenated prefixes camel-case ("acme-ds-" → "__acmeDsHandlers").
const HANDLERS = "__" + P.split("-").filter(Boolean)
  .map((s, i) => (i ? s.charAt(0).toUpperCase() + s.slice(1) : s)).join("") + "Handlers";

/* The two "Run JavaScript" bodies. Handlers live on the element (el.<HANDLERS>), never on
 * $public: $public is one object shared by every instance of the Block, so a second instance
 * overwrote the first's handlers and destroying either disconnected the other. OnDestroy looks
 * the element up again from its own WidgetId. Events are raised through Raise<Event> Block
 * Client Actions because $actions reaches Client Actions, not Block events. The resolver
 * mirrors the shipped window.<Ns>Toast resolve() — the id may point at the element itself OR
 * the wrapping Block/Container. customEvents entries are [event, BlockEvent, detailArg?, param?]. */
function eventWiring(tag, customEvents) {
  // pad the quoted event token so the handler column lines up
  const qW = Math.max(...customEvents.map(([ev]) => ev.length + 2));
  const q = (ev) => `'${ev}'`.padEnd(qW);
  const resolve = [
    `var root = document.getElementById($parameters.WidgetId);`,
    `var el = (root && root.tagName && root.tagName.toLowerCase() === '${tag}')`,
    `  ? root : (root ? root.querySelector('${tag}') : null);`,
  ];
  const each = (method) => [
    `  Object.keys(el.${HANDLERS}).forEach(function (type) {`,
    `    el.${method}(type, el.${HANDLERS}[type]);`,
    `  });`,
  ];

  const onReady = [
    `// Block OnReady — "Run JavaScript" node. Input: WidgetId = <ElementName>.Id`,
    ...resolve,
    `if (el && !el.${HANDLERS}) {`,
    `  el.${HANDLERS} = {`,
    ...customEvents.map(([ev, blockEv, detail], i) =>
      `    ${q(ev)}: function (e) { $actions.${raiseName(blockEv)}(${detail || ""}); }` +
      (i < customEvents.length - 1 ? "," : "")),
    `  };`,
    ...each("addEventListener"),
    `}`,
  ].join("\n");

  const onDestroy = [
    `// Block OnDestroy — "Run JavaScript" node. Input: WidgetId = <ElementName>.Id`,
    ...resolve,
    `if (el && el.${HANDLERS}) {`,
    ...each("removeEventListener"),
    `  delete el.${HANDLERS};`,
    `}`,
  ].join("\n");

  return { onReady, onDestroy };
}

function wiringSection(entry) {
  const w = wiringOf(entry);
  if (!w) return null;
  const { onReady, onDestroy } = eventWiring(w.tag, w.customEvents);
  const rows = w.customEvents.map(([ev, blockEv, detail]) =>
    `| \`${ev}\` | \`$actions.${raiseName(blockEv)}(${detail || ""})\` | \`${blockEv}\` |`);
  const actions = w.customEvents.map((c) => {
    const param = raiseParam(c);
    return param
      ? `| \`${raiseName(c[1])}\` | \`${param}\` | one Trigger Event → \`${c[1]}\`, parameter = \`${param}\` |`
      : `| \`${raiseName(c[1])}\` | — | one Trigger Event → \`${c[1]}\` |`;
  });
  return [
    WIRING_MARKER,
    ``,
    `> The component's CustomEvents are wired in the Block's **OnReady** and cleaned up in`,
    `> **OnDestroy** — the declarative "Handle Events" path is unreliable for custom elements.`,
    `> Give the \`<${w.tag}>\` element (or its wrapping Block) a **Name** and pass its`,
    `> platform-generated \`.Id\` to **both** "Run JavaScript" nodes as \`WidgetId\`. Paste the`,
    `> two blocks verbatim.`,
    ``,
    `**Store nothing on \`$public\`.** It is one object shared by every instance of the Block, not`,
    `one per instance: with two instances on a screen, the second OnReady overwrites the first's`,
    `handlers, and destroying either one disconnects the other's events. The handlers are kept on`,
    `the element itself (\`el.${HANDLERS}\`), and OnDestroy finds the element again from its own`,
    `\`WidgetId\`.`,
    ``,
    `| CustomEvent | calls | raises Block event |`,
    `|---|---|---|`,
    ...rows,
    ``,
    `### Block Client Actions — the bridge from JavaScript to the events`,
    ``,
    `\`$actions\` in a "Run JavaScript" node reaches **Client Actions**, not Block events — only a`,
    `**Trigger Event** node raises a Block event. Create one Client Action **on the Block** per`,
    `event, each containing a **single Trigger Event node** and nothing else:`,
    ``,
    `| Client Action | Input | Body |`,
    `|---|---|---|`,
    ...actions,
    ``,
    `Give each input the same data type as the Block event's parameter.`,
    ``,
    `**OnReady** — resolve the element, attach listeners, keep them on the element:`,
    ``,
    "```js",
    onReady,
    "```",
    ``,
    `**OnDestroy** — resolve the element again, remove its listeners:`,
    ``,
    "```js",
    onDestroy,
    "```",
  ].join("\n");
}

/* ── "## Build in ODC with Mentor Studio" ────────────────────────────────────── */
// "<prefix>button-dropdown.md" → "ButtonDropdown"
function pascal(md) {
  return basename(md, ".md").replace(new RegExp(`^${P}`), "")
    .split("-").map((s) => s.charAt(0).toUpperCase() + s.slice(1)).join("");
}

// Fully-filled Web Component prompt from a `mentor` spec.
function wcFilled(m) {
  const tag = m.tag;
  // pad input name/type columns to the widest entry so the list stays aligned
  const nameW = Math.max(...m.inputs.map(([n]) => n.length));
  const typeW = Math.max(...m.inputs.map(([, t]) => t.length));
  const inputs = m.inputs.map(([n, t, d]) => `     ${n.padEnd(nameW)} : ${t.padEnd(typeW)} : ${d}`).join("\n");
  const attrW = Math.max(...m.attrs.map(([a]) => a.length));
  const attrs = m.attrs.map(([a, e]) => `     ${a.padEnd(attrW)} = ${e}`).join("\n");
  const ce = m.customEvents.map(([c, ev]) => `the "${c}" CustomEvent triggers ${ev}`).join(", and ");
  const raiseW = Math.max(...m.customEvents.map(([, ev]) => raiseName(ev).length + 2));
  const raises = m.customEvents.map((c) => {
    const param = raiseParam(c);
    return `        - ${`"${raiseName(c[1])}"`.padEnd(raiseW)} : ` + (param
      ? `input ${param}; one Trigger Event node → ${c[1]}, parameter = ${param}.`
      : `no inputs; one Trigger Event node → ${c[1]}.`);
  });

  // Static-Entity note (Type/Position/etc. are enumerations, not free Text).
  const seLines = (m.staticEntities || []).map((e) => {
    const recs = e.records.map(([r, v]) => `${r} = "${v}"`).join(", ");
    return `   - ${e.name}: ${recs}`;
  });
  const seBlock = seLines.length ? [
    `   Static Entities — create these first. Give each a SINGLE Text attribute "${(m.staticEntities[0] || {}).attr || "Value"}"`,
    `   set as the record Identifier, and delete the default Id/Label/Order/Is_Active attributes.`,
    `   Each record's value IS the literal the Web Component expects, so the input binds straight`,
    `   to the attribute (no .Value suffix). Model the matching inputs as the entity, NOT free Text:`,
    ...seLines,
  ] : [];

  // Step 4 — address by the platform-generated widget .Id, only if a global helper exists.
  const helperStep = m.helper ? [
    ``,
    `4. OutSystems generates element ids at runtime, so you address a specific instance by its`,
    `   widget's platform id — NOT a hand-typed string. Give the <${tag}> element (or its`,
    `   Block) a Name, then create client action(s) with a "Run JavaScript" node that take a`,
    `   WidgetId Text input set to <thatWidgetName>.Id and call the helper:`,
    ...m.methods.map((meth) => {
      const name = meth.charAt(0).toUpperCase() + meth.slice(1) + m.block;
      return `     - "${name}": ${m.helper}.${meth}($parameters.WidgetId);`;
    }),
    `   The helper resolves the <${tag}> from that id (it accepts the element id or a`,
    `   wrapping Block/Container id).`,
  ] : [
    ``,
    `4. This component exposes no global helper — drive it entirely through the Block inputs`,
    `   and events above; there is no id to pass.`,
  ];

  return [
    `Goal: In ODC Studio, wire up an OutSystems Block that wraps the already-imported custom`,
    `Web Component <${tag}> for the ${DS} design system.`,
    `Module: ${PATTERNS}.`,
    ``,
    `Context (already done manually — do NOT re-create or edit these):`,
    `- dist/theme.css (brand + component tokens) is already pasted into the ODC Theme editor.`,
    `- ${tag}.js is already imported as a Script resource (Theme/Library), ${m.include}. It`,
    `  defines the custom element <${tag}>${m.helper ? ` and the global helper ${m.helper}` : ``}.`,
    `- Do NOT write CSS, author or modify JavaScript, or edit the Theme. Your job is only the`,
    `  Block, its inputs/events, the attribute bindings, the event wiring${m.helper ? `, and the Client` : ``}`,
    m.helper ? `  Actions that drive the component.` : `  the component needs.`,
    ``,
    `Task — create these elements, referencing each by the exact name given:`,
    ``,
    `1. Create a Block named "${m.block}" with input parameters:`,
    inputs,
    `   and Block events: ${m.events.join(", ")}.`,
    ...seBlock,
    `   Do NOT add a string Id input or set the element's id — OutSystems generates ids at`,
    `   runtime (see step 4 for addressing).`,
    ``,
    `2. Place an HTML element <${tag}> in the Block. Set one attribute per input via a Value`,
    `   expression (ODC requires an expression on every attribute):`,
    attrs,
    `   Static-Entity inputs bind directly (e.g. type = Type) — the Value attribute is the`,
    `   record Identifier. Use If(flag,"true","false") for every Boolean (values, not presence).`,
    ``,
    `3. Wire CustomEvents to Block events: ${ce}.`,
    `   a. A JavaScript node cannot raise a Block event directly — $actions reaches Client`,
    `      Actions, and only a Trigger Event node raises an event. Create one Client Action ON`,
    `      THE BLOCK per event, each a single Trigger Event node:`,
    ...raises,
    `   b. Do NOT use the declarative "Handle Events" path (unreliable for custom elements).`,
    `      Add a "Run JavaScript" node in the Block's OnReady and a second in OnDestroy, each`,
    `      with a WidgetId (Text) input = <the <${tag}> element's Name>.Id. OnReady attaches the`,
    `      listeners and calls the Raise actions from 3a; OnDestroy removes them. The exact code`,
    `      is in this handover's "## Event wiring (OnReady / OnDestroy)" section — paste it`,
    `      verbatim (you are placing provided JS, not authoring it).`,
    `   c. Store nothing on $public: it is one shared object, not one per Block instance, and a`,
    `      second instance on the screen would lose its events.`,
    ...helperStep,
    ``,
    `Constraints: never edit the OutSystems UI module; add no CSS or hard-coded values (styling`,
    `comes from var(--token) in the Theme). After generating, list every element you created by`,
    `name and flag any step you could not finish so I can do it manually.`,
    ``,
    `Start with step 1 (the Block "${m.block}" interface) and show it to me before wiring.`,
  ].join("\n");
}

// Fully-filled prompt for a restyle-based Block with placeholders (e.g. the Field Wrapper):
// the Block wraps NATIVE widgets dropped into placeholders, styled via Extended Class — there
// is no single custom element to bind attributes on, so this differs from wcFilled.
function blockFilled(m) {
  const nameW = Math.max(...m.inputs.map(([n]) => n.length));
  const typeW = Math.max(...m.inputs.map(([, t]) => t.length));
  const inputs = m.inputs.map(([n, t, d]) => `     ${n.padEnd(nameW)} : ${t.padEnd(typeW)} : ${d}`).join("\n");
  const phW = Math.max(...m.placeholders.map(([n]) => n.length));
  const phs = m.placeholders.map(([n, d]) => `     ${n.padEnd(phW)} — ${d}`).join("\n");
  const seLines = (m.staticEntities || []).map((e) => {
    const recs = e.records.map(([r, v]) => `${r} = "${v}"`).join(", ");
    return `   - ${e.name}: ${recs}`;
  });

  return [
    `Goal: In ODC Studio, build an OutSystems Block "${m.block}" that lays out the ${DS}`,
    `Field Wrapper (FieldLabel row + Input + Helper) around NATIVE OutSystems widgets, styled`,
    `purely by the already-pasted CSS + tokens via Extended Class.`,
    `Module: ${PATTERNS}.`,
    ``,
    `Context (already done manually — do NOT re-create or edit these):`,
    `- dist/theme.css and ${P}text-field.css are already pasted into the ODC Theme editor`,
    `  (below OutSystems UI). The look is pure CSS + var(--token) — do NOT write or edit CSS.`,
    `- ${P}field-count.js is already imported as a Script resource (Include = Always); it`,
    `  defines the global helper ${m.helper} and live-updates the character-count badge.`,
    ``,
    `Task — create these elements, referencing each by the exact name given:`,
    ``,
    `1. Create a Block named "${m.block}" with placeholders:`,
    phs,
    `   input parameters:`,
    inputs,
    `   and Block events: ${m.events.join(", ")}.`,
    ``,
    `   Static Entities — create these first. Give each a SINGLE Text attribute "Value" set as`,
    `   the record Identifier (delete the default Id/Label/Order/Is_Active). Each value IS the`,
    `   literal CSS class the markup expects, so inputs bind straight to it (no .Value suffix):`,
    ...seLines,
    ``,
    `2. Build the Block markup as nested Containers (set Extended Class via the Value expression`,
    `   — ODC requires an expression on every Extended Class):`,
    `   a. Root Container — ExtendedClass =`,
    `        Layout + " " + Size + If(Rounded, " ${P}field--rounded", "")`,
    `      (the FieldLayout value carries "${P}field"; Size adds "${P}field--<size>", which`,
    `      scales the label row AND the input/placeholder text together). When ShowCharCount,`,
    `      also add the attribute data-${P}field-count = "" so the count script wires this field.`,
    `   b. Label-row Container (ExtendedClass = "${P}field__label-row") holding, in order:`,
    `        - If(IsRequired): an Expression <span class="${P}field__required" aria-hidden="true">*</span>`,
    `        - the Label placeholder (drop a Label widget bound to LabelText; set its Mandatory`,
    `          property = IsRequired for the native accessibility hook).`,
    `        - If(IsOptional): an Expression <span class="${P}field__optional">(optional)</span>`,
    `        - If(ShowCharCount): an Expression`,
    `            <span class="${P}field__count">0/<MaxLength></span>`,
    `   c. The Input placeholder — the consumer drops a native Input / Text Area here. Its`,
    `      ExtendedClass = State only (the wrapper Size already sets the height + text size;`,
    `      State adds is-warning / is-read-only where applicable, Error is native .not-valid).`,
    `      Bind the Input's Max Length = MaxLength.`,
    `   d. The Helper placeholder, wrapped in <span class="${P}field__helper"> (add the state`,
    `      modifier --error / --warning / --success / --disabled to match State).`,
    ``,
    `3. State mapping note — Error is driven by native form Validation (.not-valid), Focused is`,
    `   native :focus, Disabled is the Input widget's Enabled = False. Only Warning (is-warning)`,
    `   and Read-Only (is-read-only) are added classes. Wire OnChange from the Input.`,
    ``,
    `4. The count badge updates itself: ${m.helper} auto-wires on render via a MutationObserver.`,
    `   If a field is added after first paint, call ${m.helper}.refresh() in the screen's`,
    `   On Render via a "Run JavaScript" node — no id needed.`,
    ``,
    `Constraints: never edit the OutSystems UI module; add no CSS or hard-coded values (styling`,
    `comes from var(--token) in the Theme). After generating, list every element you created by`,
    `name and flag any step you could not finish so I can do it manually.`,
    ``,
    `Start with step 1 (the Block "${m.block}" interface + Static Entities) and show it to me`,
    `before building the markup.`,
  ].join("\n");
}

// Generic Web Component prompt (no `mentor` spec): point Mentor at this handover's API tables.
function wcGeneric(block, tag, jsFile, dest) {
  return [
    `Goal: In ODC Studio, wire up an OutSystems Block that wraps the already-imported custom`,
    `Web Component <${tag}> for the ${DS} design system.`,
    `Module: ${PATTERNS}.`,
    ``,
    `Context (already done manually — do NOT re-create or edit these):`,
    `- dist/theme.css and any block CSS are already pasted into the ODC Theme editor.`,
    `- ${jsFile} is already imported as a ${dest}. It defines the custom element <${tag}>.`,
    `- Do NOT write CSS, author/modify JavaScript, or edit the Theme. Your job is only the`,
    `  Block, its inputs/events, the attribute bindings, the event wiring, and any Client`,
    `  Actions that drive it.`,
    ``,
    `Task — reference every element by the exact name given. Take the exact inputs, attribute`,
    `bindings, events and any global helper from this handover's "API — Attributes / Methods /`,
    `Events" tables (paste the relevant table into the chat so I work from real names):`,
    ``,
    `1. Create a Block named "${block}". Add one input per attribute (use the documented`,
    `   default) and one event per CustomEvent. Model enumerable attributes (variant / type /`,
    `   size / position / status) as Static Entities — one record per allowed value, with a`,
    `   single Text attribute (e.g. "Value") set as the record Identifier (delete the default`,
    `   Id/Label/Order/Is_Active) holding the literal the component expects — not free Text;`,
    `   keep free-form text as Text and flags as Boolean. Do NOT add a string Id input or set`,
    `   the element's id; OutSystems generates ids at runtime (see step 4).`,
    `2. Place <${tag}> in the Block. Bind each attribute to its input with a Value expression`,
    `   (ODC requires one on every attribute). Static-Entity inputs bind directly (e.g.`,
    `   type = Type) since their Value attribute is the identifier; Booleans use`,
    `   If(Flag, "true", "false") — not presence.`,
    `3. Wire each CustomEvent to its Block event in the Block's OnReady (attach) and OnDestroy`,
    `   (remove) — not via the declarative "Handle Events" path, which is unreliable for custom`,
    `   elements.`,
    `   a. A JavaScript node cannot raise a Block event directly — $actions reaches Client`,
    `      Actions, and only a Trigger Event node raises an event. For each Block event create a`,
    `      Client Action ON THE BLOCK named "Raise<Event>" (e.g. "RaiseOnChange") containing a`,
    `      single Trigger Event node, with one input per event parameter passed straight through.`,
    `   b. Add a "Run JavaScript" node in OnReady and a second in OnDestroy, each with a WidgetId`,
    `      (Text) input = <the <${tag}> element's Name>.Id. Paste the verbatim code from this`,
    `      handover's "## Event wiring (OnReady / OnDestroy)" section: OnReady attaches the`,
    `      listeners and calls the Raise actions; OnDestroy removes them.`,
    `   c. Store nothing on $public: it is one shared object, not one per Block instance, and a`,
    `      second instance on the screen would lose its events.`,
    `4. If the component exposes a global helper (see its API section), give the element/Block`,
    `   a Name and pass its platform-generated runtime .Id, e.g.`,
    `   window.${NS}X.show($parameters.WidgetId) where the WidgetId input = <WidgetName>.Id.`,
    ``,
    `Constraints: never edit the OutSystems UI module; add no CSS or hard-coded values (styling`,
    `comes from var(--token) in the Theme). After generating, list every element you created by`,
    `name and flag anything you could not finish.`,
    ``,
    `Work iteratively: create the Block interface in step 1 and show it to me before wiring.`,
  ].join("\n");
}

// Custom Block prompt: real widgets + placeholders + typed inputs, one required Script driven by the
// Block's lifecycle. Mentor builds it from this handover's "## The Block" section.
function blockGeneric(block, jsFile) {
  const api = `${NS}.${block}`;
  return [
    `Goal: In ODC Studio, build the OutSystems Block "${block}" for the ${DS} design system: real`,
    `widgets, placeholders and typed input parameters, with one required Script for its behaviour.`,
    `Module: ${PATTERNS}.`,
    ``,
    `Context (already done manually — do NOT re-create or edit these):`,
    `- dist/theme.css, including this component's CSS, is pasted into the theme. Do NOT write CSS.`,
    `- ${jsFile} is imported in this module as a Script. It defines window.${api} with init, update`,
    `  and destroy. Do NOT author or modify JavaScript beyond the three calls in step 5.`,
    ``,
    `Task — take every name from this handover's "The Block" section and create, referencing each`,
    `by the exact name given (paste that section into the chat so the names are real):`,
    ``,
    `1. Static Entities for every enumerable input (variant, size, state, orientation): a single Text`,
    `   attribute "Value" set as the record Identifier (delete the default Id, Label, Order and`,
    `   Is_Active), one record per allowed value, holding the literal the CSS expects.`,
    `2. The Block "${block}" with its input parameters (Static Entity Identifiers, Booleans, Text),`,
    `   its Placeholders and its Block events. Do NOT add a string Id input.`,
    `3. The widget tree exactly as the handover shows it, with each widget's Style Classes /`,
    `   ExtendedClass expression as given (ODC requires an expression on every Extended Class).`,
    `   Build real widgets; never paste HTML into an Expression or an HTML Element. Name the widget`,
    `   the script works on as the handover says.`,
    `4. For each Block event, a Client Action on the Block named "Raise<Event>" holding a single`,
    `   Trigger Event node, with one input per event parameter passed straight through.`,
    `5. Three Block event handlers, each a Client Action with one "Run JavaScript" node whose`,
    `   WidgetId (Text) input = <the named widget>.Id, plus the inputs the call reads. Paste the`,
    `   calls from the handover verbatim:`,
    `     OnReady:             ${api}.init($parameters.WidgetId, { … }, { onX: function (v) { $actions.RaiseOnX(v); } });`,
    `     OnParametersChanged: ${api}.update($parameters.WidgetId, { … });`,
    `     OnDestroy:           ${api}.destroy($parameters.WidgetId);`,
    `   Store nothing on $public.`,
    `6. Set the Script as the Block's only Required Script. Do not include it module-wide.`,
    ``,
    `Constraints: never edit the OutSystems UI module; add no CSS or hard-coded values (styling`,
    `comes from var(--token) in the Theme). After generating, list every element you created by`,
    `name and flag anything you could not finish.`,
    ``,
    `Work iteratively: create the Static Entities and the Block interface (step 1–2) and show them`,
    `to me before building the widget tree.`,
  ].join("\n");
}

// Native-widget restyle prompt: most work is using the right widget + Extended Class.
function restyleGeneric(block, cssFile) {
  return [
    `Goal: In ODC Studio, apply the ${DS} styling for ${block} to the native`,
    `OutSystems UI widget(s) it restyles.`,
    ``,
    `Context (already done): ${cssFile} and dist/theme.css are already pasted into the ODC`,
    `Theme editor (below OutSystems UI). The look is pure CSS + tokens — there is nothing for`,
    `you to style, and you must not write or edit CSS.`,
    ``,
    `Task — this component RESTYLES a native OutSystems widget, so the work is using the right`,
    `widget, not generating styles. Referencing elements by name:`,
    `1. Use the native OutSystems widget this maps to (see this handover's "When to use" /`,
    `   "Variant mapping" section), not a custom element.`,
    `2. Apply each variant via the Extended Class property only (e.g. ExtendedClass =`,
    `   "<documented-modifier>") — never mutate OutSystems UI internals.`,
    `3. Build any screen/Block logic the screen needs around it.`,
    ``,
    `Constraints: never edit the OutSystems UI module; add no CSS or hard-coded values. After`,
    `generating, list what you created by name and flag anything you could not finish.`,
  ].join("\n");
}

// Style-Guide reference element: just place it on the Style Guide screen.
function refGeneric(block, tag, jsFile) {
  return [
    `Goal: In ODC Studio, place the Style-Guide reference element <${tag}> on the Style Guide`,
    `screen for the ${DS} design system.`,
    `Module: ${LSG}.`,
    ``,
    `Context (already done): ${jsFile} is added under Resources and loads on the Style-Guide`,
    `screen; dist/theme.css is in the Theme. It is a self-contained display component.`,
    ``,
    `Task: add the <${tag}> element to the Style Guide screen where this specimen belongs.`,
    `There are no inputs or events to wire. Do NOT write CSS or JavaScript.`,
    ``,
    `Constraints: never edit the OutSystems UI module; add no styles. Report what you placed.`,
  ].join("\n");
}

/* The derived prompts are written for Mentor. On O11 the same steps go to a developer in Service
 * Studio: drop what only makes sense to an agent (the "show it to me" turn-taking and the report
 * request) and keep the constraints. */
function forO11(text) {
  const kept = [];
  for (const line of text.split("\n")) {
    if (/^(Start with step 1|Work iteratively)/.test(line)) break;
    kept.push(line);
  }
  return kept.join("\n")
    .replace(/In ODC Studio, /g, "In Service Studio, ")
    .replace(/the ODC Theme editor/g, "the theme module's style sheet")
    .replace(/ODC requires (an expression|one)/g, "the platform requires $1")
    .replace(/ \(paste the relevant table into the chat so I work from real names\)/, "")
    .replace(/ \(paste that section into the chat so the names are real\)/, "")
    .replace(/After generating, list[\s\S]*$/, "")
    .trimEnd();
}

function mentorPrompt(md, entry) {
  const text = derivedPrompt(md, entry);
  return O11 ? forO11(text) : text;
}

function derivedPrompt(md, entry) {
  const m = entry.mentor;
  if (m && m.text) return m.text;                   // verbatim prompt from the map
  if (m && m.kind === "web-component") return wcFilled(m);
  if (m && m.kind === "block") return blockFilled(m);

  const arts = entry.files;
  const jsArt = arts.find((a) => a[1] === "js");
  const cssArt = arts.find((a) => a[1] === "css");
  const destStr = arts.map((a) => a[2]).join(" ");
  const kind = (m && m.kind) ||
    (jsArt
      ? /Required Script/i.test(destStr) ? "custom-block"
        : /Script resource/i.test(destStr) ? "web-component" : "reference"
      : "restyle");
  const block = pascal(md);

  if (kind === "custom-block") return blockGeneric(block, basename(jsArt[0]));
  if (kind === "web-component") {
    const tag = basename(jsArt[0], ".js");
    return wcGeneric(block, tag, basename(jsArt[0]), jsArt[2]);
  }
  if (kind === "reference") {
    const tag = (m && m.tag) || basename(jsArt[0], ".js");
    return refGeneric(block, tag, basename(jsArt[0]));
  }
  return restyleGeneric(block, basename(cssArt[0]));
}

function mentorSection(md, entry) {
  const prompts = entry.mentor && entry.mentor.prompts;
  if (O11) {
    const steps = prompts ? prompts : [{ title: null, text: mentorPrompt(md, entry) }];
    return [
      MENTOR_MARKER,
      ``,
      `> O11 has no Mentor Studio. Follow these steps in **Service Studio**, in the module each one`,
      `> names, after the paste/import steps in the checklist. Where Service Studio's MCP server is`,
      `> connected, the same steps can be applied through it — then verify in a browser.`,
      ...steps.flatMap((p) => [``, ...(p.title ? [`### ${p.title}`, ``] : []), "```", O11 ? forO11(p.text) : p.text, "```"]),
    ].join("\n");
  }
  if (prompts) {
    return [
      MENTOR_MARKER,
      ``,
      `> Paste each prompt into **ODC Mentor Studio** in the module it names, in this order. Mentor`,
      `> does **not** author the CSS, so paste the theme first (see the checklist). Reusable template +`,
      `> notes: \`handover/MENTOR-STUDIO-PROMPT.md\`.`,
      ...prompts.flatMap((p) => [``, `### ${p.title}`, ``, "```", p.text, "```"]),
    ].join("\n");
  }
  return [
    MENTOR_MARKER,
    ``,
    `> Paste this into **ODC Mentor Studio** to scaffold the OutSystems side of this handover`,
    `> (Block, inputs, widgets, event wiring, Client Actions). Mentor is a logic/data agent —`,
    `> it does **not** author the CSS or the JavaScript, so do the paste/import steps in the`,
    `> checklist first. Reusable template + notes: \`handover/MENTOR-STUDIO-PROMPT.md\`.`,
    ``,
    "```",
    mentorPrompt(md, entry),
    "```",
  ].join("\n");
}

/* ── shared upsert: refresh a marked section in place, or insert it at a chosen anchor ── */
function upsert(text, marker, blockText, insertIdxFn) {
  const lines = text.split("\n");
  const block = blockText.split("\n");
  const markers = [marker].flat();

  const markerIdx = lines.findIndex((l) => markers.includes(l.trimEnd()));
  if (markerIdx !== -1) {
    // refresh in place: replace from the marker up to the next "## " heading, dropping the
    // blank lines that separated the old section from it (we re-add exactly one).
    let endIdx = lines.findIndex((l, i) => i > markerIdx && /^##\s+/.test(l));
    if (endIdx === -1) endIdx = lines.length;
    const before = lines.slice(0, markerIdx);
    const after = lines.slice(endIdx);
    return [...before, ...block, ...(after.length ? ["", ...after] : [])].join("\n");
  }

  let idx = insertIdxFn(lines);
  if (idx < 0) return text; // anchor missing → leave unchanged
  if (idx > lines.length) idx = lines.length;
  return [...lines.slice(0, idx), ...block, "", ...lines.slice(idx)].join("\n");
}

/* ── drive ────────────────────────────────────────────────────────────────────── */
let changed = 0;
for (const [md, raw] of Object.entries(MAP)) {
  if (md.startsWith("$")) continue; // $comment — documentation inside the data file, not an entry
  const entry = Array.isArray(raw) ? { files: raw } : raw;
  if (!entry.files?.length && !entry.mentor) continue; // `[]` — a prose handover with no code to embed
  const path = join(handoverDir, md);
  let text;
  try { text = readFileSync(path, "utf8"); } catch { console.warn(`skip (missing): ${md}`); continue; }
  const original = text;

  // 1) "## Code to paste into ODC" — after the "## Files" table
  let codeBlock;
  try { codeBlock = section(entry.files); }
  catch (e) { console.warn(`skip (${e.message}): ${md}`); continue; }
  text = upsert(text, CODE_MARKERS, codeBlock, (lines) => {
    const filesIdx = lines.findIndex((l) => /^##\s+Files\b/.test(l));
    if (filesIdx === -1) return -1;
    const nextIdx = lines.findIndex((l, i) => i > filesIdx && /^##\s+/.test(l));
    return nextIdx === -1 ? lines.length : nextIdx;
  });

  // 2) "## Event wiring (OnReady / OnDestroy)" — just before the Mentor section (only for
  //    components that dispatch CustomEvents)
  const wiring = wiringSection(entry);
  if (wiring) {
    text = upsert(text, WIRING_MARKER, wiring, (lines) => {
      const mi = lines.findIndex((l) => BUILD_MARKERS.includes(l.trimEnd()));
      if (mi !== -1) return mi;
      const ci = lines.findIndex((l) => /^##\s+Checklist\b/.test(l));
      return ci === -1 ? lines.length : ci;
    });
  }

  // 3) "## Build in ODC with Mentor Studio" — just before "## Checklist" (else at EOF)
  text = upsert(text, BUILD_MARKERS, mentorSection(md, entry), (lines) => {
    const ci = lines.findIndex((l) => /^##\s+Checklist\b/.test(l));
    return ci === -1 ? lines.length : ci;
  });

  if (text !== original) { writeFileSync(path, text); console.log(`updated: ${md}`); changed++; }
  else console.log(`unchanged: ${md}`);
}
console.log(`\n${changed} handover file(s) updated.`);
