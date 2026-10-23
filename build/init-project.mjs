#!/usr/bin/env node
/* init-project.mjs — fill in the template ONCE, in one place, for a new engagement.
 *
 * Asks for the handful of values that actually differ between projects, writes them
 * into project.config.json, and substitutes every <<PLACEHOLDER>> across the scaffold
 * docs. After this runs, `npm run check:config` passes and the build works.
 *
 * Usage:  npm run init   (re-runnable; shows current values as defaults) */
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync, unlinkSync } from "node:fs";
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
/* First run on a fresh copy of the template: its release notes, version and LICENSE are the
 * template's, not this project's, and are reset below. */
const firstRun = JSON.stringify(cfg).includes("<<");
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
const jsNs = await ask(`JS namespace for custom Block scripts, window.<Ns>.<Block> (e.g. ${nsDefault})`, has(cfg.jsNamespace) ? cfg.jsNamespace : nsDefault, "js-namespace");
/* Asked first: it decides the module kinds below, whether there is a tenant MCP endpoint (ODC only),
 * and how handovers are written (Mentor prompts on ODC, Service Studio steps on O11). */
let environment = String(await ask("Platform: ODC or O11", cfg.environment || "ODC", "environment")).trim().toUpperCase();
if (!["ODC", "O11"].includes(environment)) {
  throw new Error(`Unknown environment "${environment}". Expected ODC or O11.`);
}

/* Whether the theme stacks on OutSystems UI. A brand theme does, redefining the framework's
 * variables. A migration of an established design system (USWDS, GOV.UK Frontend, Material…)
 * does not: it is built as it is, from its own tokens, on a theme with no base theme. */
const frameworkRaw = String(await ask(
  "Build on OutSystems UI? yes = a brand theme on OutSystems UI; no = migrating an established design system (USWDS, GOV.UK, Material…) as is",
  cfg.framework === "none" ? "no" : "yes",
  "framework"
)).trim().toLowerCase();
const framework = { yes: "outsystems-ui", y: "outsystems-ui", "outsystems-ui": "outsystems-ui", no: "none", n: "none", none: "none" }[frameworkRaw];
if (!framework) throw new Error(`Unknown answer "${frameworkRaw}". Expected yes or no (--framework=outsystems-ui | none).`);

/* Where the work lands: every module, and on O11 every application, by role. Defaults follow the
 * playbook's naming (ODC: NimbusTheme / NimbusPatterns / NimbusLiveStyleGuide / Template_Nimbus;
 * O11: Nimbus_Theme … in "<Customer> Theme" and "<Customer> Live Style Guide"). Accept them unless
 * the customer's environment already uses other names. */
const pascal = (v) => String(v).replace(/[^A-Za-z0-9]+(.)?/g, (_, c) => (c ? c.toUpperCase() : "")).replace(/^./, (c) => c.toUpperCase());
const known = (role) => (has(cfg.modules?.[role]?.name) ? cfg.modules[role].name : "");
const base = pascal(dsName);
let modules;
if (environment === "ODC") {
  const theme = await ask("ODC Theme library", known("theme") || (has(cfg.odcThemeModule) ? cfg.odcThemeModule : `${base}Theme`), "theme-module");
  const stem = theme.replace(/Theme$/, "") || base;
  modules = {
    theme: { name: theme, kind: "library" },
    patterns: { name: await ask("ODC Patterns library", known("patterns") || `${stem}Patterns`, "patterns-module"), kind: "library" },
    liveStyleGuide: { name: await ask("ODC Live Style Guide app", known("liveStyleGuide") || `${stem}LiveStyleGuide`, "lsg-module"), kind: "app" },
    template: { name: await ask("ODC Template app", known("template") || `Template_${stem}`, "template-module"), kind: "app" },
  };
} else {
  const themeApp = await ask("O11 Theme application", cfg.modules?.theme?.app || `${customer} Theme`, "theme-app");
  const lsgApp = await ask("O11 Live Style Guide application", cfg.modules?.liveStyleGuide?.app || `${customer} Live Style Guide`, "lsg-app");
  const theme = await ask("O11 Theme module", known("theme") || (has(cfg.odcThemeModule) ? cfg.odcThemeModule : `${base}_Theme`), "theme-module");
  const stem = theme.replace(/_?Theme$/, "") || base;
  modules = {
    theme: { name: theme, kind: "CrossDevice", app: themeApp },
    patterns: { name: await ask("O11 Patterns module", known("patterns") || `${stem}_Patterns`, "patterns-module"), kind: "ReactiveLibrary", app: themeApp },
    liveStyleGuide: { name: await ask("O11 Live Style Guide module", known("liveStyleGuide") || `${stem}_LSG`, "lsg-module"), kind: "CrossDevice", app: lsgApp },
    patPreview: { name: await ask("O11 Patterns Preview module", known("patPreview") || `${stem}_PatPreview`, "patpreview-module"), kind: "CrossDevice", app: lsgApp },
    template: { name: await ask("O11 Template module", known("template") || `Template_${stem}`, "template-module"), kind: "CrossDevice", app: lsgApp },
  };
}
const themeModule = modules.theme.name;
const repo = await ask("GitHub repo (owner/repo)", has(cfg.repo) ? cfg.repo : "", "repo");
const figmaUrl = await ask("Figma library URL (blank if not yet known)", has(cfg.figma?.url) ? cfg.figma.url : "", "figma-url");
const figmaKey = figmaUrl.match(/(?:file|design)\/([A-Za-z0-9]+)/)?.[1] ?? "";

/* The ODC tenant is the project's tenant of record. OutSystems' own `outsystems` plugin declares
 * the MCP server from its `tenant_hostname` option, which lives in each developer's user settings,
 * so this value is what they pass to it; nothing in the repo registers the server.
 *
 * NEVER guess it. A wrong tenant points every ODC call at somebody else's environment and
 * could publish into it. Blank is the correct answer when unknown: the value stays
 * <<ODC_TENANT>> and check:config keeps failing until a human fills it in. "none" records that
 * this project has no MCP access: odcTenant is null and handovers carry Mentor prompts only. */
const odcTenantRaw = environment === "O11" ? "" : await ask(
  "ODC tenant hostname for the MCP (e.g. acme.outsystems.dev; none = no MCP access; blank if not yet known)",
  has(cfg.odcTenant) ? cfg.odcTenant : "",
  "odc-tenant"
);
const noMcp = /^none$/i.test(String(odcTenantRaw ?? "").trim());
const odcTenant = noMcp ? "" : String(odcTenantRaw ?? "")
  .trim()
  .replace(/^https?:\/\//i, "")
  .replace(/^www\./i, "")
  .replace(/[/?#].*$/, "");
if (odcTenant && !/^[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?$/.test(odcTenant)) {
  throw new Error(
    `"${odcTenantRaw}" is not a plausible hostname. Expected something like acme.outsystems.dev.`
  );
}

Object.assign(cfg, {
  customer, project,
  designSystemName: dsName,
  classPrefix: prefix,
  jsNamespace: jsNs,
  environment,
  framework,
  modules: { $comment: cfg.modules?.$comment, ...modules },
  // null, not a placeholder, on O11 or with no MCP access: there is no tenant to fill in later.
  odcTenant: environment === "O11" || noMcp ? null : odcTenant || "<<ODC_TENANT>>",
  repo,
  figma: { fileKey: figmaKey || "<<FIGMA_FILE_KEY>>", url: figmaUrl || "<<FIGMA_URL>>" },
});
cfg.findings.ticketTarget = repo;
writeFileSync(CONFIG, JSON.stringify(cfg, null, 2) + "\n");

/* A project-scope `outsystems` server would duplicate or hide the plugin's, so an old one goes. */
const MCP = join(root, ".mcp.json");
if (existsSync(MCP)) {
  const mcp = JSON.parse(readFileSync(MCP, "utf8"));
  if (mcp.mcpServers?.outsystems) {
    delete mcp.mcpServers.outsystems;
    const others = Object.keys(mcp.mcpServers).length > 0;
    if (others) writeFileSync(MCP, JSON.stringify(mcp, null, 2) + "\n");
    else unlinkSync(MCP);
    console.log(`  removed the outsystems server from .mcp.json${others ? "" : " (and the empty file)"} — the plugin declares it`);
  }
}
if (odcTenant) {
  console.log("  ODC MCP: OutSystems' plugin, set once per machine:");
  console.log(`    claude plugin install outsystems@outsystems --config tenant_hostname=${odcTenant}`);
} else if (environment === "O11") {
  console.log("  O11 MCP: Service Studio's own server, set up on each machine.");
  console.log("  Without it, handovers carry Service Studio steps.");
} else if (noMcp) {
  console.log("  No MCP access recorded; handovers carry Mentor prompts.");
} else {
  console.log("  No ODC tenant given; check:config fails until it is, or until you re-run with");
  console.log("  --odc-tenant=none to record that this project has no MCP access.");
}

/* Substitute the same values across the scaffold docs. */
const SUBS = {
  "<<CUSTOMER>>": customer,
  "<<PROJECT>>": project,
  "<<DESIGN_SYSTEM_NAME>>": dsName,
  "<<CLASS_PREFIX>>": prefix,
  "<<JS_NAMESPACE>>": jsNs,
  "<<THEME_MODULE>>": themeModule,
  "<<ODC_THEME_MODULE>>": themeModule,
  "<<PATTERNS_MODULE>>": modules.patterns.name,
  "<<LSG_MODULE>>": modules.liveStyleGuide.name,
  "<<TEMPLATE_MODULE>>": modules.template.name,
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

if (firstRun) {
  const CHANGELOG = join(root, "CHANGELOG.md");
  if (existsSync(CHANGELOG)) {
    const log = readFileSync(CHANGELOG, "utf8");
    const head = log.slice(0, log.search(/^## \[/m) === -1 ? log.length : log.search(/^## \[/m));
    writeFileSync(CHANGELOG, head.trimEnd() + "\n\n## [Unreleased]\n");
    console.log("  reset CHANGELOG.md — the template's release notes are not this project's");
  }
  for (const f of ["package.json", "package-lock.json"]) {
    const path = join(root, f);
    if (!existsSync(path)) continue;
    const json = JSON.parse(readFileSync(path, "utf8"));
    json.version = "0.0.0";
    delete json.license;
    if (json.packages?.[""]) delete json.packages[""].license;
    if (json.packages?.[""]) json.packages[""].version = "0.0.0";
    writeFileSync(path, JSON.stringify(json, null, 2) + "\n");
  }
  console.log("  version reset to 0.0.0 — the first `npm run release -- minor` makes it 0.1.0");
  const LICENSE = join(root, "LICENSE");
  if (existsSync(LICENSE)) {
    unlinkSync(LICENSE);
    console.log("  removed the template's LICENSE — choose this project's own");
  }
}

await rl?.close();
const steps = framework === "none"
  ? [
      "npm run check:config        # must pass; it is part of the build gate",
      "record \"not built on OutSystems UI\" in specs/decisions.md; the theme has no base theme",
      `./.github/setup-finding-labels.sh ${repo || "<owner/repo>"}`,
      "write specs/foundations/ from the design system's own documentation and tokens",
    ]
  : [
      "npm run check:config        # must pass; it is part of the build gate",
      "git submodule update --init # vendor/outsystems-ui — then pin it to your environment's version",
      `./.github/setup-finding-labels.sh ${repo || "<owner/repo>"}`,
      "write specs/foundations/ from the brand guidelines",
    ];
steps.push("fill loop/goal.md: the goal + the SIGNED-OFF component inventory", "/lsg:design-loop");
console.log(`
Done — ${touched} file(s) updated.

Next:
${steps.map((s, i) => `  ${i + 1}. ${s}`).join("\n")}
`);
