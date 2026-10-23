#!/usr/bin/env node
/* build-catalogue.mjs — writes specs/widget-library/catalogue.json: the static-entity records a
 * widget library's Live Style Guide is seeded with. Categories, every widget with its docs text,
 * and per widget its property rows (from the code, extract-api.mjs), keyboard interactions and
 * state selectors (from content.json). The LSG's reference sections render from these records, so
 * a widget's reference is data, not screen content.
 *
 *   npm run widgets:catalogue     after changing a widget or its docs; then reseed the app
 *
 * Exit 1 when a widget has no category or no docs content: a gap here is a page with no text. */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { extractApi } from "./extract-api.mjs";
import { SPEC_DIR, WidgetLibraryError, contentFor, loadLibrary } from "./lib.mjs";

/* osfe's member sections → the Kind column of the API table. */
const SECTION_KIND = {
  Variables: "Variable",
  Properties: "Property",
  "Attribute selectors": "Attribute",
  Events: "Event",
  Placeholders: "Placeholder",
  Iterators: "Placeholder",
};

/* Mentor ran out of memory seeding 537 records in one go; past this, ask for batches. */
const SEED_BATCH = 150;

const fill = (pattern, values) => pattern.replace(/\{(\w+)\}/g, (_, k) => values[k] ?? "");

export function buildCatalogue(library = loadLibrary()) {
  const { settings, content } = library;
  const api = extractApi(library);
  const categories = settings.categories ?? [];
  const listed = categories.flatMap((c) => c.widgets);
  const missing = Object.keys(api).filter((w) => !listed.includes(w));
  if (missing.length) throw new WidgetLibraryError(`Widgets without a category in library.json: ${missing.join(", ")}`);
  const unknown = listed.filter((w) => !api[w]);
  if (unknown.length) throw new WidgetLibraryError(`library.json lists widgets the library does not export: ${unknown.join(", ")}`);
  for (const w of listed) contentFor(content, w);

  const css = settings.cssClass ?? { pattern: "{widget}" };
  const docs = settings.docsUrl;
  return {
    categories: categories.map((c, i) => ({ Name: c.name, Order: i + 1 })),
    widgets: categories.flatMap((c) =>
      c.widgets.map((key, i) => ({
        Key: key,
        Name: api[key].name,
        Category: c.name,
        Order: i + 1,
        Description: api[key].description,
        Lead: content[key].lead,
        Usage: content[key].usage,
        A11yNote: content[key].a11y,
        CssClass: css.overrides?.[key] ?? fill(css.pattern, { widget: key }),
        ...(docs ? { DocsUrl: fill(docs.pattern, { page: docs.pages?.[key] ?? key }) } : {}),
        HasPage: true,
      }))
    ),
    properties: listed.flatMap((key) =>
      api[key].props.map((p, i) => ({
        Widget: key,
        Order: i + 1,
        Kind: SECTION_KIND[p.section] ?? p.section,
        Name: p.name,
        Type: p.options ? p.options.join(" | ") : p.type === "()" ? "No parameters" : p.type,
        Default: p.defaultValue?.replace(/^"(.*)"$/, "$1") ?? "",
        IsMandatory: p.required,
        Description: p.description,
      }))
    ),
    keyboard: listed.flatMap((key) =>
      (content[key].keyboard ?? []).map(([keys, action], i) => ({ Widget: key, Order: i + 1, Keys: keys, Action: action }))
    ),
    states: listed.flatMap((key) =>
      (content[key].states ?? []).map((selector, i) => ({ Widget: key, Order: i + 1, Selector: selector }))
    ),
  };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const catalogue = buildCatalogue();
    writeFileSync(join(SPEC_DIR, "catalogue.json"), JSON.stringify(catalogue, null, 2) + "\n");
    const counts = Object.entries(catalogue).map(([k, rows]) => `${rows.length} ${k}`);
    console.log(`widgets:catalogue → specs/widget-library/catalogue.json  (${counts.join(", ")})`);
    for (const [k, rows] of Object.entries(catalogue)) {
      if (rows.length > SEED_BATCH) console.log(`  note: ${rows.length} ${k} records — ask Mentor to seed them in batches of about ${SEED_BATCH}.`);
    }
  } catch (err) {
    if (!(err instanceof WidgetLibraryError)) throw err;
    console.error(`widgets:catalogue: ${err.message}`);
    process.exit(1);
  }
}
