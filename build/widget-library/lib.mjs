/* lib.mjs — what the widgets:* generators share: the widget library from project.config.json, the
 * project's docs data under specs/widget-library/, and TypeScript to read the widgets with.
 *
 * Only for a Live Style Guide that documents an osfe widget library (a WidgetLibrary asset).
 * Inputs, all hand-written, none generated:
 *   project.config.json → widgetLibrary   { name, source }: the asset, and its osfe source folder
 *   specs/widget-library/library.json     categories, sample-data map, blocks, overrides
 *   specs/widget-library/content.json     each widget's docs text, keyboard table, example data */
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { projectConfig, root } from "../lib/project-config.mjs";

export const SPEC_DIR = join(root, "specs", "widget-library");

export class WidgetLibraryError extends Error {}

function readJson(path, what) {
  if (!existsSync(path)) throw new WidgetLibraryError(`${what} is missing: ${path.replace(root, ".")} — see specs/widget-library/README.md`);
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (err) {
    throw new WidgetLibraryError(`${path.replace(root, ".")} is not valid JSON: ${err.message}`);
  }
}

/** The library's source folder, its docs settings and its docs content. */
export function loadLibrary() {
  const wl = projectConfig().widgetLibrary;
  if (!wl?.source) {
    throw new WidgetLibraryError(
      "project.config.json → widgetLibrary is null. The widgets:* generators are for a Live Style Guide that documents " +
        "an osfe widget library; set { \"name\", \"source\" } (npm run init asks for it)."
    );
  }
  const source = resolve(root, wl.source);
  if (!existsSync(source)) throw new WidgetLibraryError(`widgetLibrary.source ${wl.source} is not on disk.`);
  const settings = readJson(join(SPEC_DIR, "library.json"), "specs/widget-library/library.json");
  const content = readJson(join(SPEC_DIR, "content.json"), "specs/widget-library/content.json");
  return { name: wl.name, source, settings, content };
}

/** TypeScript's JavaScript compiler API: the project's own copy first, then the widget library's
 *  (osfe libraries pin typescript 5). TypeScript 7 is the native port and has no such API. */
export function loadTypeScript(source) {
  for (const from of [join(root, "package.json"), join(source, "package.json")]) {
    try {
      const ts = createRequire(from)("typescript");
      if (typeof ts.createSourceFile === "function") return ts;
    } catch {
      /* try the next one */
    }
  }
  throw new WidgetLibraryError(
    "No TypeScript with the JavaScript compiler API here or in the widget library. Run " +
      "`npm install` inside the library's source folder, or `npm i -D typescript@5` here " +
      "(typescript 7 has no compiler API)."
  );
}

/** Every widget's docs content, by the widget's exported name; throws on a missing one. */
export function contentFor(content, key) {
  const c = content[key];
  if (!c) throw new WidgetLibraryError(`No docs content for ${key} in specs/widget-library/content.json`);
  return c;
}
