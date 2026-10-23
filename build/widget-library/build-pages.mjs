#!/usr/bin/env node
/* build-pages.mjs — writes the spec of every widget page of a widget library's Live Style Guide,
 * for Mentor to build from, plus the Studio checklist for the widgets themselves.
 *
 *   specs/widget-library/pages/NN-<category>.md   one file per category = one Mentor turn:
 *                                                 attach it, build that batch, publish
 *   specs/widget-library/widget-slots.md          every slot, with the widget and bindings that
 *                                                 go in it, for the Studio step
 *
 * Bindings, variables and the API come from the widget code (extract-api.mjs); prose, keyboard
 * behaviour and example data come from content.json. Mentor cannot reference a widget library or
 * open an app that does, so every widget goes in an empty slot that is filled in ODC Studio later:
 * slots first, widgets last.
 *
 *   npm run widgets:pages
 *
 * Exit 1 on a gap the build would trip on (no sample data, an unmapped sample source). A batch over
 * 7 screens or 14 KB is printed as a warning: split its category. */
import { mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { projectConfig, usesOutSystemsUI } from "../lib/project-config.mjs";
import { extractApi } from "./extract-api.mjs";
import { SPEC_DIR, WidgetLibraryError, contentFor, loadLibrary } from "./lib.mjs";

const MAX_SCREENS = 7;
const MAX_BYTES = 14 * 1024;

/* Names of the shared blocks from the foundation spec (specs/widget-library/README.md); override
 * any of them in library.json → blocks. */
const BLOCKS = {
  flow: "MainFlow",
  layout: "LayoutDocs",
  pageHeader: "PageHeader",
  sectionTitle: "SectionTitle",
  exampleCard: "ExampleCard",
  codeSnippet: "CodeSnippet",
  reference: "WidgetReference",
  onThisPage: "WidgetOnThisPage",
  navigate: "GoToWidget",
  navigatingBlocks: ["SidebarCategoryLinks", "CategoryCards"],
};

/* The widgets an example's controls are built from; override in library.json → controls. */
const CONTROLS = {
  boolean: { widget: "Switch", bind: "Is selected" },
  value: { widget: "Slider", bind: "Value" },
};

const OS_TYPE = {
  "Variable<Boolean>": "Boolean",
  "Variable<Text>": "Text",
  "Variable<Decimal>": "Decimal",
  "Variable<OSDate>": "Date",
  "Variable<OSTime>": "Time",
  "Variable<OSDateTime>": "Date Time",
};

/* A variable's Default Value must be a literal: `CurrDate()` is accepted, `AddDays(CurrDate(), 3)`
 * is rejected. Anything else is assigned in OnInitialize. Add a function here only once Mentor has
 * accepted it as a Default Value. */
const DEFAULT_FUNCTIONS = new Set(["CurrDate", "CurrDateTime"]);
export function isLiteral(expr) {
  const e = String(expr).trim();
  return (
    e === "(default)" ||
    /^"(?:[^"]|"")*"$/.test(e) ||
    /^-?\d+(?:\.\d+)?$/.test(e) ||
    /^(?:True|False)$/.test(e) ||
    /^#[\d:\- ]+#$/.test(e) ||
    (/^(\w+)\(\)$/.test(e) && DEFAULT_FUNCTIONS.has(e.slice(0, -2)))
  );
}

const pascal = (key) => key.charAt(0).toUpperCase() + key.slice(1);

function buildSpec(key, widget, category, library) {
  const { settings, content } = library;
  const c = contentFor(content, key);
  const blocks = { ...BLOCKS, ...settings.blocks };
  const controlsCfg = { ...CONTROLS, ...settings.controls };
  const label = settings.slotLabel ?? library.name.replace(/_Widgets$/, "");
  const skip = new Set(settings.skipProperties ?? []);
  const variables = [];
  const actions = [...(c.extraActions ?? [])];
  const bindings = [];
  const controls = [];
  const aggregates = [`GetWidget: Widget where Key = "${key}"`];

  const variable = (name, type, initial) => variables.push({ name, type, initial: initial ?? "(default)" });
  for (const p of widget.props) {
    if (skip.has(p.key)) continue;
    const varName = `Example${pascal(p.key)}`;
    if (p.section === "Variables") {
      variable(varName, OS_TYPE[p.type] ?? p.type, c.defaults?.[p.key]);
      bindings.push(`${p.name} = ${varName}`);
    } else if (p.type === "Record List") {
      if (!c.data) throw new WidgetLibraryError(`${key} has a Record List property (${p.name}) but no data in content.json`);
      /* One explicit map, never an inflected plural: a People → Person guess that never matched
       * once sent Mentor an entity that does not exist. */
      const sample = settings.samples?.[c.data.source];
      if (!sample?.entity || !sample?.aggregate) {
        throw new WidgetLibraryError(`${key} reads sample data "${c.data.source}", which library.json → samples does not map to { entity, aggregate }`);
      }
      aggregates.push(`${sample.aggregate}: every ${sample.entity} record, ordered by Order`);
      bindings.push(`${p.name} = ${sample.aggregate}.List`);
    } else if (p.section === "Attribute selectors") {
      const attr = c.data?.attributes?.[p.key];
      if (attr) bindings.push(`${p.name} = ${attr}`);
      else if (p.required) throw new WidgetLibraryError(`${key}.${p.key} is required but content.json gives it no sample attribute`);
    } else if (p.section === "Events") {
      const action = `On${p.name.split(/[^A-Za-z]+/).map(pascal).join("")}`;
      actions.push({ name: action, does: `sets ExampleLastEvent to "${p.name} fired"` });
      bindings.push(`${p.name} = ${action}`);
    } else if (p.type === "Placeholder") {
      const fill = c.placeholders?.[p.key];
      if (fill) bindings.push(`${p.name} placeholder: ${fill}`);
    } else if (c.texts?.[p.key] !== undefined) {
      bindings.push(`${p.name} = ${c.texts[p.key]}`);
    } else if (p.affectsPreview && p.type === "Boolean") {
      variable(varName, "Boolean", p.defaultValue === "true" ? "True" : "False");
      bindings.push(`${p.name} = ${varName}`);
      const ctl = controlsCfg.boolean;
      controls.push({ name: `Slot_Control${pascal(p.key)}`, text: `${label} ${ctl.widget} · Label "${p.name}" · ${ctl.bind} = ${varName}` });
    } else if (p.affectsPreview && p.type === "Decimal" && p.key === "value") {
      variable(varName, "Decimal", c.defaults?.value ?? "40");
      bindings.push(`${p.name} = ${varName}`);
      const ctl = controlsCfg.value;
      controls.push({ name: "Slot_ControlValue", text: `${label} ${ctl.widget} · Label "Value" · ${ctl.bind} = ${varName}` });
    }
  }
  const hasEvents = widget.props.some((p) => p.section === "Events");
  if (hasEvents) variable("ExampleLastEvent", "Text", '""');

  /* Computed initial values move to OnInitialize, which only assigns: no data is fetched there. */
  const onInitialize = [];
  for (const v of variables) {
    if (isLiteral(v.initial)) continue;
    onInitialize.push(`${v.name} = ${v.initial}`);
    v.initial = "(set in OnInitialize)";
  }

  const previewSlots = [...(c.extraSlots ?? []), { name: "Slot_Example", text: `${label} ${widget.name} · ${bindings.join(" · ")}` }];
  const code = [key, ...bindings.map((b) => `  ${b}`)].join("\n");
  return { key, name: widget.name, category, blocks, variables, onInitialize, aggregates, actions, previewSlots, controlSlots: controls, hasEvents, code };
}

function render(spec, prefix) {
  const b = spec.blocks;
  const lines = [];
  const out = (s = "") => lines.push(s);
  out(`## ${spec.name} — screen \`${spec.key}\``);
  out();
  out(`Anonymous screen \`${spec.key}\` in ${b.flow} (if the name is reserved, use \`${spec.key}Page\`), on ${b.layout} with ActiveWidgetKey = "${spec.key}". Add a "${spec.key}" branch to ${b.navigate} in ${b.navigatingBlocks.join(" and ")}.`);
  out();
  out("**Aggregates:**");
  for (const a of spec.aggregates) out(`- ${a}`);
  out();
  out("**Local variables:**");
  out();
  out("| Name | Type | Initial value |");
  out("|---|---|---|");
  for (const v of spec.variables) out(`| ${v.name} | ${v.type} | ${v.initial} |`);
  if (!spec.variables.length) out("| (none) | | |");
  out();
  if (spec.onInitialize.length) {
    out("**OnInitialize** (a Default Value must be a literal, so these are assigned here; assign only, fetch nothing):");
    for (const a of spec.onInitialize) out(`- ${a}`);
    out();
  }
  if (spec.actions.length) {
    out("**Screen actions:**");
    for (const a of spec.actions) out(`- ${a.name}: ${a.does}`);
    out();
  }
  out("**Content placeholder, in order:**");
  out();
  out(`1. ${b.pageHeader}, every input from GetWidget: Title = Widget.Name, Lead = Widget.Lead, Category = WidgetCategory.Name, DocsUrl = Widget.DocsUrl.`);
  out(`2. ${b.sectionTitle} "Example" (anchor "example"), then ${b.exampleCard} with HasControls = ${spec.controlSlots.length ? "True" : "False"}:`);
  out("   - Preview:");
  for (const s of spec.previewSlots) out(`     - \`${s.name}\`: ${s.text}`);
  if (spec.hasEvents) out(`     - a Text with class ${prefix}example__status: If(ExampleLastEvent = "", "No events yet.", ExampleLastEvent)`);
  if (spec.controlSlots.length) {
    out("   - Controls:");
    for (const s of spec.controlSlots) out(`     - \`${s.name}\`: ${s.text}`);
  }
  out(`   - Code: ${b.codeSnippet} with Code =`);
  out("     ```");
  for (const l of spec.code.split("\n")) out(`     ${l}`);
  out("     ```");
  out(`3. ${b.reference} with WidgetKey "${spec.key}" (Usage, Accessibility, API and Styling, all from data).`);
  out();
  out(`**OnThisPage:** ${b.onThisPage}.`);
  out();
  return lines.join("\n");
}

function intro(category, blocks, prefix) {
  const shared = [blocks.layout, blocks.pageHeader, blocks.exampleCard, blocks.codeSnippet, blocks.reference, blocks.onThisPage].join(", ");
  return (
    `# ${category}: widget docs screens\n\n` +
    `Each section is one screen, built from the shared blocks of the foundation spec: ${shared}. ` +
    `A screen holds only what is unique to it, its example; every reference section renders from data. ` +
    `Every library widget goes in an empty slot: a Container with that Name and Style Classes "${prefix}slot", ` +
    `holding one Text with the slot description. Widgets are added in ODC Studio later. ` +
    `${usesOutSystemsUI() ? "" : "No OutSystems UI, "}no inline styles, ${prefix} classes only.\n\n`
  );
}

function slotChecklist(specs, library) {
  const lines = [
    `# Studio checklist: the ${library.name} widgets`,
    "",
    "Generated by `npm run widgets:pages`; do not edit. Mentor built each page with a slot where each widget goes,",
    "because it cannot reference a widget library or open an app that does. In ODC Studio: add the dependency once",
    `(Manage Dependencies → ${library.name} → all widgets → Apply), then for each slot below delete its Text, drop the`,
    "widget into the Container and set exactly what the slot says. Every variable and action it names already exists.",
    "",
  ];
  for (const s of specs) {
    lines.push(`## ${s.name} — \`${s.key}\``, "", "| Slot | Widget and bindings |", "|---|---|");
    for (const slot of [...s.previewSlots, ...s.controlSlots]) lines.push(`| \`${slot.name}\` | ${slot.text.replace(/\|/g, "\\|")} |`);
    lines.push("");
  }
  return lines.join("\n");
}

export async function buildPages(library = loadLibrary()) {
  const api = extractApi(library);
  const prefix = projectConfig().classPrefix;
  const handBuilt = new Set(library.settings.handBuilt ?? []);
  const dir = join(SPEC_DIR, "pages");
  mkdirSync(dir, { recursive: true });
  /* Category files are generated; anything else in pages/ (00-foundation.md) is hand-written. */
  for (const f of readdirSync(dir)) if (/^(0[1-9]|[1-9]\d)-.*\.md$/.test(f)) rmSync(join(dir, f));

  const all = [];
  const warnings = [];
  for (const [i, category] of (library.settings.categories ?? []).entries()) {
    const specs = category.widgets.filter((k) => !handBuilt.has(k)).map((k) => {
      if (!api[k]) throw new WidgetLibraryError(`library.json lists ${k}, which the library does not export`);
      return buildSpec(k, api[k], category.name, library);
    });
    if (!specs.length) continue;
    const file = `${String(i + 1).padStart(2, "0")}-${category.name.toLowerCase().replace(/[^a-z]+/g, "-")}.md`;
    const text = intro(category.name, specs[0].blocks, prefix) + specs.map((s) => render(s, prefix)).join("\n");
    writeFileSync(join(dir, file), text);
    const bytes = Buffer.byteLength(text);
    if (specs.length > MAX_SCREENS || bytes > MAX_BYTES) {
      warnings.push(`pages/${file}: ${specs.length} screens, ${(bytes / 1024).toFixed(1)} KB — over one Mentor batch (${MAX_SCREENS} screens, 14 KB); split the category`);
    }
    all.push(...specs);
  }
  writeFileSync(join(SPEC_DIR, "widget-slots.md"), slotChecklist(all, library));
  return { screens: all.length, warnings };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const { screens, warnings } = await buildPages();
    console.log(`widgets:pages → specs/widget-library/pages/ (${screens} screen specs) and widget-slots.md`);
    for (const w of warnings) console.log(`  warning: ${w}`);
  } catch (err) {
    if (!(err instanceof WidgetLibraryError)) throw err;
    console.error(`widgets:pages: ${err.message}`);
    process.exit(1);
  }
}
