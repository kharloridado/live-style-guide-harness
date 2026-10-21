/* project-config.mjs — the ONE place build scripts read project values from.
 *
 * Every build script that needs the class prefix, the JS namespace, the design-system
 * name, or the ODC theme-module name reads it from `project.config.json` through here.
 * Nothing hard-codes them.
 */
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

let cached;

export function projectConfig() {
  if (cached) return cached;
  const path = join(root, "project.config.json");
  try {
    cached = JSON.parse(readFileSync(path, "utf8"));
  } catch (err) {
    throw new Error(
      `Could not read project.config.json at ${path}.\n` +
        `It is the source of truth for this project's values. Run: npm run init\n${err.message}`
    );
  }
  return cached;
}

