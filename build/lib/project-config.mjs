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

/** The name of the module that plays `role` (theme | patterns | liveStyleGuide | template |
 *  patPreview). Projects initialised before `modules` existed keep the theme in odcThemeModule. */
export function moduleName(role) {
  const cfg = projectConfig();
  return cfg.modules?.[role]?.name ?? (role === "theme" ? cfg.odcThemeModule : undefined);
}

/** False for a project built without OutSystems UI (`uiFramework: "none"`): no framework base is
 *  compiled, and specimen pages stack the theme alone, as the app does. */
export function usesOutSystemsUI() {
  return projectConfig().uiFramework !== "none";
}
