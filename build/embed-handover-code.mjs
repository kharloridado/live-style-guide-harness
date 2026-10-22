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
 *                                          inputs, widgets, the Script's lifecycle calls,
 *                                          Client Actions). See handover/MENTOR-STUDIO-PROMPT.md.
 *
 * On O11 (`environment` in project.config.json) the same sections are headed "… into Service
 * Studio" and "## Build in Service Studio", and the prompt becomes steps for a developer.
 * Every prompt names the module it runs in, from `modules`.
 *
 * A MAP entry is either `[[file, lang, dest], …]` (files only) or
 * `{ files: [[…]], mentor: { … } }` to override the auto-derived Mentor prompt with a
 * fully-filled one. When `mentor` is absent the prompt is derived from the artifact kind
 * (custom Block with a required Script, or native-widget restyle). A JS file whose destination names a "Required Script" is a custom Block's.
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

/* ── "## Build in ODC with Mentor Studio" ────────────────────────────────────── */
// "<prefix>button-dropdown.md" → "ButtonDropdown"
function pascal(md) {
  return basename(md, ".md").replace(new RegExp(`^${P}`), "")
    .split("-").map((s) => s.charAt(0).toUpperCase() + s.slice(1)).join("");
}

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
  if (m && m.kind === "block") return blockFilled(m);

  const arts = entry.files;
  const jsArt = arts.find((a) => a[1] === "js");
  const cssArt = arts.find((a) => a[1] === "css");
  const destStr = arts.map((a) => a[2]).join(" ");
  const block = pascal(md);
  if (jsArt && !/Required Script/i.test(destStr)) {
    throw new Error(
      `${md}: ${jsArt[0]} is not a custom Block's Required Script. Web Components are not handed ` +
        `over any more — build the component as a custom Block and name the JS destination "Required Script".`
    );
  }
  if (jsArt) return blockGeneric(block, basename(jsArt[0]));
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

  // 2) "## Build in ODC with Mentor Studio" — just before "## Checklist" (else at EOF)
  text = upsert(text, BUILD_MARKERS, mentorSection(md, entry), (lines) => {
    const ci = lines.findIndex((l) => /^##\s+Checklist\b/.test(l));
    return ci === -1 ? lines.length : ci;
  });

  if (text !== original) { writeFileSync(path, text); console.log(`updated: ${md}`); changed++; }
  else console.log(`unchanged: ${md}`);
}
console.log(`\n${changed} handover file(s) updated.`);
