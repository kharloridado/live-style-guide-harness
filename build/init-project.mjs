#!/usr/bin/env node
/* init-project.mjs — fill in the template ONCE, in one place, for a new engagement.
 *
 * Asks for the handful of values that actually differ between projects, writes them
 * into project.config.json, and substitutes every <<PLACEHOLDER>> across the scaffold
 * docs. After this runs, `npm run check:config` passes and the build works.
 *
 * The whole point: you answer each question exactly once. The previous template made
 * you hand-edit the same value into several files, which is how it ended up shipping a
 * class prefix that two config files disagreed about for the life of the project.
 *
 * Note the deliberate refusal to guess. Conventions (spacing base, grid, breakpoints,
 * default size) default to status "TBD" — NOT to a plausible value. An unverified
 * convention that looks confirmed is worse than an obviously empty one: the loop will
 * enforce it, flag every value that "violates" it, and hand a human a queue of findings
 * that get closed as not-planned.
 *
 * Usage:  npm run init   (re-runnable; shows current values as defaults) */
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, relative } from "node:path";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { root } from "./lib/project-config.mjs";

const CONFIG = join(root, "project.config.json");
const SCAN_DIRS = ["", "loop", "handover", "findings", "specs", "tokens", "src"];
const SCAN_EXT = /\.(md|json|css|js|html|sh)$/;

/* Flags let this run non-interactively (CI, scripted bootstrap, a test harness):
 *   node build/init-project.mjs --customer="Acme Corp" --prefix=nimbus- --repo=acme/ds
 * Anything not passed as a flag is prompted for. */
const flags = Object.fromEntries(
  process.argv.slice(2)
    .filter((a) => a.startsWith("--"))
    .map((a) => {
      const [k, ...v] = a.slice(2).split("=");
      return [k, v.join("=")];
    })
);
const interactive = stdin.isTTY;
const rl = interactive ? createInterface({ input: stdin, output: stdout }) : null;

const ask = async (q, def, flag) => {
  if (flag && flags[flag] !== undefined) return flags[flag];
  if (!rl) {
    if (def) return def;
    throw new Error(
      `Non-interactive run is missing --${flag}.\n` +
        `Pass every value as a flag, or run \`npm run init\` from a terminal.`
    );
  }
  const a = (await rl.question(def ? `${q} [${def}]: ` : `${q}: `)).trim();
  return a || def || "";
};

console.log(`
Initialise this OutSystems design-system project.
Answer once — these values are written everywhere they are needed.
`);

const cfg = JSON.parse(readFileSync(CONFIG, "utf8"));
const has = (v) => v && !/^<<.*>>$/.test(v);

const customer = await ask("Customer (e.g. Acme Corp)", has(cfg.customer) ? cfg.customer : "", "customer");
const project = await ask("Project short name (e.g. ACME)", has(cfg.project) ? cfg.project : "", "project");
const dsName = await ask("Design system name (e.g. Nimbus)", has(cfg.designSystemName) ? cfg.designSystemName : project, "design-system");

let prefix = await ask("CSS class prefix, lowercase + trailing hyphen (e.g. nimbus-)", has(cfg.classPrefix) ? cfg.classPrefix : "", "prefix");
while (!/^[a-z][a-z0-9]*-$/.test(prefix) || prefix === "acme-") {
  const why = prefix === "acme-"
    ? '"acme-" is the template\'s own example prefix — pick a real one for this project.'
    : 'The prefix must be lowercase and end with a hyphen, e.g. "nimbus-".';
  if (!rl) throw new Error(`Invalid --prefix "${prefix}". ${why}`);
  console.log(`  ${why}`);
  prefix = await ask("CSS class prefix", "");
}

const nsDefault = prefix.replace(/-$/, "").replace(/(^|[-_])(\w)/g, (_, __, c) => c.toUpperCase());
const jsNs = await ask(`JS namespace for Web Component helpers, window.<Ns>Toast (e.g. ${nsDefault})`, has(cfg.jsNamespace) ? cfg.jsNamespace : nsDefault, "js-namespace");
/* O11 projects have no tenant MCP endpoint — Service Studio's own MCP server is the design-time
 * channel there, configured per machine, not per repo. Asked before the theme module so the
 * prompt can say which platform the module lives on. */
let environment = String(await ask("Platform: ODC or O11", cfg.environment || "ODC", "environment")).trim().toUpperCase();
if (!["ODC", "O11"].includes(environment)) {
  throw new Error(`Unknown environment "${environment}". Expected ODC or O11.`);
}

const themeModule = await ask(`${environment} theme module name (used for self-hosted font paths, e.g. NimbusTheme)`, has(cfg.odcThemeModule) ? cfg.odcThemeModule : "", "theme-module");
const repo = await ask("GitHub repo (owner/repo)", has(cfg.repo) ? cfg.repo : "", "repo");
const figmaUrl = await ask("Figma library URL (blank if not yet known)", has(cfg.figma?.url) ? cfg.figma.url : "", "figma-url");
const figmaKey = figmaUrl.match(/(?:file|design)\/([A-Za-z0-9]+)/)?.[1] ?? "";

/* The ODC tenant is the ONE project value that must exist in TWO files: the harness reads
 * .mcp.json before any build script runs, so it cannot resolve the value through
 * project-config.mjs. The copy is therefore GENERATED here and CHECKED by check:config —
 * documentation saying "keep these two in sync by hand" is a promise nobody keeps.
 *
 * NEVER guess it. A wrong tenant points every ODC call at somebody else's environment and
 * could publish into it. Blank is the correct answer when unknown: the value stays
 * <<ODC_TENANT>> and check:config keeps failing until a human fills it in. */
const odcTenantRaw = environment === "O11" ? "" : await ask(
  "ODC tenant hostname (e.g. acme.outsystems.dev — blank if not yet known)",
  has(cfg.odcTenant) ? cfg.odcTenant : "",
  "odc-tenant"
);
const odcTenant = String(odcTenantRaw ?? "")
  .trim()
  .replace(/^https?:\/\//i, "")
  .replace(/^www\./i, "")
  .replace(/[/?#].*$/, "");
if (odcTenant && !/^[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?$/.test(odcTenant)) {
  throw new Error(
    `"${odcTenantRaw}" is not a plausible hostname. Expected something like acme.outsystems.dev.`
  );
}

console.log(`
Conventions (spacing base, grid, breakpoints, default component size) start as "TBD"
on purpose. Do NOT guess them. Promote one to "confirmed" in project.config.json only
once the designer or brand owner has actually confirmed it — the checker enforces a
convention only when it is confirmed, and raises findings against it only then.
`);

Object.assign(cfg, {
  customer, project,
  designSystemName: dsName,
  classPrefix: prefix,
  jsNamespace: jsNs,
  environment,
  odcThemeModule: themeModule,
  // null, not a placeholder, on O11: there is no tenant to fill in later.
  odcTenant: environment === "O11" ? null : odcTenant || "<<ODC_TENANT>>",
  repo,
  figma: { fileKey: figmaKey || "<<FIGMA_FILE_KEY>>", url: figmaUrl || "<<FIGMA_URL>>" },
});
cfg.findings.ticketTarget = repo;
writeFileSync(CONFIG, JSON.stringify(cfg, null, 2) + "\n");

/* Generate .mcp.json from the tenant rather than asking anyone to hand-edit it. The ODC
 * MCP is a remote HTTP endpoint served by the tenant itself; nothing installs locally and
 * no token is stored, because auth is OAuth with Dynamic Client Registration. */
const MCP = join(root, ".mcp.json");
if (odcTenant) {
  const mcp = existsSync(MCP) ? JSON.parse(readFileSync(MCP, "utf8")) : {};
  mcp.mcpServers = { ...(mcp.mcpServers ?? {}), outsystems: { type: "http", url: `https://${odcTenant}/mcp` } };
  writeFileSync(MCP, JSON.stringify(mcp, null, 2) + "\n");
  console.log(`  wrote .mcp.json → https://${odcTenant}/mcp`);
} else if (environment === "O11") {
  console.log("  .mcp.json not needed on O11 — design-time access is Service Studio's own MCP server.");
} else {
  console.log("  .mcp.json NOT written — no ODC tenant given; check:config will fail until it is.");
}

/* Substitute the same values across the scaffold docs. */
const SUBS = {
  "<<CUSTOMER>>": customer,
  "<<PROJECT>>": project,
  "<<DESIGN_SYSTEM_NAME>>": dsName,
  "<<CLASS_PREFIX>>": prefix,
  "<<JS_NAMESPACE>>": jsNs,
  "<<ODC_THEME_MODULE>>": themeModule,
  "<<OWNER/REPO>>": repo,
  "<<FIGMA_URL>>": figmaUrl,
  "<<FIGMA_FILE_KEY>>": figmaKey,
  /* Only substituted when known — replacing it with "" would erase the placeholder and
   * hide the fact that nobody has supplied a tenant yet. */
  ...(odcTenant ? { "<<ODC_TENANT>>": odcTenant } : {}),
};

let touched = 0;
const skipDir = new Set(["node_modules", "vendor", "dist", ".git"]);
function walk(dir, depth = 0) {
  for (const entry of readdirSync(dir)) {
    if (skipDir.has(entry) || entry.startsWith(".")) continue;
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) { if (depth < 3) walk(p, depth + 1); }
    else if (SCAN_EXT.test(entry)) substitute(p);
  }
}
function substitute(path) {
  const before = readFileSync(path, "utf8");
  let after = before;
  for (const [k, v] of Object.entries(SUBS)) if (v) after = after.split(k).join(v);
  if (after !== before) {
    writeFileSync(path, after);
    console.log(`  updated ${relative(root, path).replace(/\\/g, "/")}`);
    touched++;
  }
}
for (const d of SCAN_DIRS) { const p = join(root, d); if (existsSync(p)) walk(p); }

await rl?.close();
console.log(`
Done — ${touched} file(s) updated.

Next:
  1. npm run check:config        # must pass; it is part of the build gate
  2. git submodule update --init # vendor/outsystems-ui — then pin it to your ODC env's version
  3. ./.github/setup-finding-labels.sh ${repo || "<owner/repo>"}
  4. write specs/foundations/ from the brand guidelines
  5. fill loop/goal.md: the goal + the SIGNED-OFF component inventory
  6. /outsystems-loop:design-loop
`);
