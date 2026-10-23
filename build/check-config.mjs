#!/usr/bin/env node
/* check-config.mjs — the guard that makes template drift impossible.
 *
 * Runs as the first step of `npm run build:theme`, which means it sits inside the
 * @checker's DETERMINISTIC GATE. A project that has not been initialised, or that has
 * leaked the template's own example values into real code, cannot build — and therefore
 * cannot pass review.
 *
 *
 * Usage:  node build/check-config.mjs
 * Exits non-zero (loudly) on any violation. */
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, relative } from "node:path";
import { projectConfig, root } from "./lib/project-config.mjs";

const PLACEHOLDER_RE = /<<[A-Z_/]+>>/;
const EXAMPLE_PREFIX = "acme-"; // the neutral prefix used in template/skill examples
const SCAN_DIRS = ["tokens", "src", "specs", "loop", "handover", "findings", "build/review"];
const SCAN_EXT = /\.(css|js|html|md|json|sh)$/;
const errors = [];
const notes = [];

/* ---- 1. project.config.json itself must be filled in --------------------------- */
const cfg = projectConfig();
const raw = readFileSync(join(root, "project.config.json"), "utf8");
if (PLACEHOLDER_RE.test(raw)) {
  const left = [...raw.matchAll(/<<[A-Z_/]+>>/g)].map((m) => m[0]);
  errors.push(
    `project.config.json still holds ${[...new Set(left)].length} unfilled placeholder(s): ` +
      `${[...new Set(left)].join(", ")}\n    → run:  npm run init`
  );
}

/* ---- 2. the class prefix must be real, and must not be the example one ---------- */
if (cfg.classPrefix === EXAMPLE_PREFIX) {
  errors.push(
    `classPrefix is still the template's example value "${EXAMPLE_PREFIX}".\n` +
      `    → set a real prefix for this project in project.config.json`
  );
}
if (cfg.classPrefix && !/^[a-z][a-z0-9]*-$/.test(cfg.classPrefix) && !PLACEHOLDER_RE.test(cfg.classPrefix)) {
  errors.push(`classPrefix "${cfg.classPrefix}" should be lowercase and end with a hyphen (e.g. "acme-").`);
}

/* ---- 4b. the platform-knowledge pack must actually be on disk ------------------- */
/* The lsg plugin's skills hold no OutSystems platform knowledge — no block catalog, no
 * variable list, no widget conventions. They read all of it from here at runtime. When this
 * is missing the loop does NOT stop: the audit classifies from memory, invents blocks that
 * do not exist, routes work to L5 that the framework already ships, and the checker cannot
 * score framework grain at all. Every one of those looks like a normal run.
 *
 * That is the difference from vendor/outsystems-ui, which fails loudly: build:osui cannot
 * compile and the specimen pages have no framework base. This one degrades quietly, so it gets a hard gate instead. */
const PK_ROOT = join(root, "vendor", "outsystems-frontend-skills");
const PK_SENTINEL = join(PK_ROOT, "ui-frameworks", "outsystems-ui", "blocks-index.md");
const pk = cfg.platformKnowledge ?? {};

if (!existsSync(PK_ROOT)) {
  errors.push(
    `vendor/outsystems-frontend-skills is missing. The loop skills read every OutSystems ` +
    `platform fact from there. On Windows this is usually a MAX_PATH truncation: run ` +
    `\`git config --global core.longpaths true\` then \`git checkout -- .\`.`
  );
} else if (!existsSync(PK_SENTINEL)) {
  errors.push(
    `vendor/outsystems-frontend-skills exists but blocks-index.md is missing — the checkout ` +
    `is incomplete, not absent. On Windows: \`git config --global core.longpaths true\` ` +
    `then \`git checkout -- .\`, and re-count the files.`
  );
}

if (!["submodule", "vendored-copy"].includes(pk.mode)) {
  errors.push(
    `platformKnowledge.mode is ${JSON.stringify(pk.mode)} — must be "submodule" or ` +
    `"vendored-copy". See ARCHITECTURE.md in the lsg plugin (live-style-guide-loop).`
  );
}
if (pk.mode === "submodule" && !pk.repo) {
  errors.push(`platformKnowledge.mode is "submodule" but repo is null — nothing to pin.`);
}
if (pk.mode === "submodule" && !pk.pin) {
  errors.push(
    `platformKnowledge.pin is null. Pin the pack to a tag or SHA — on "main" the block ` +
    `catalog can move under a running project with no commit in this repo.`
  );
}

/* ---- 5. no placeholder or example prefix may survive in real project files ------ */
function walk(dir) {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === "vendor" || entry.startsWith(".")) continue;
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) walk(p);
    else if (SCAN_EXT.test(entry)) scan(p);
  }
}

function scan(path) {
  const rel = relative(root, path).replace(/\\/g, "/");
  // Docs that show the example prefix on purpose (templates, the Mentor prompt, history).
  const isExampleDoc = /(^|\/)(EXAMPLE-|MENTOR-STUDIO-PROMPT|README|CHANGELOG)/i.test(rel);
  const text = readFileSync(path, "utf8");

  text.split("\n").forEach((line, i) => {
    if (PLACEHOLDER_RE.test(line) && !isExampleDoc) {
      errors.push(`${rel}:${i + 1} — unfilled placeholder ${line.match(PLACEHOLDER_RE)[0]}`);
    }
    // Real code must never carry the template's example prefix.
    if (line.includes(EXAMPLE_PREFIX) && !isExampleDoc && /^(tokens|src|specs|build\/review)\//.test(rel)) {
      errors.push(`${rel}:${i + 1} — the template's example prefix "${EXAMPLE_PREFIX}" leaked into real code`);
    }
  });
}

SCAN_DIRS.forEach((d) => walk(join(root, d)));

/* ---- ODC tenant and the MCP server ---------------------------------------------- */
/* OutSystems' `outsystems` plugin declares the ODC server from each developer's
 * tenant_hostname option. A project-scope `outsystems` entry would duplicate or hide it. */
const MCP_PATH = join(root, ".mcp.json");
if (existsSync(MCP_PATH)) {
  try {
    if (JSON.parse(readFileSync(MCP_PATH, "utf8"))?.mcpServers?.outsystems) {
      errors.push(
        ".mcp.json declares an `outsystems` server, which duplicates or hides the one OutSystems' " +
          "plugin declares. Re-run `npm run init` to remove it, then set the plugin's tenant: " +
          "`claude plugin install outsystems@outsystems --config tenant_hostname=<odcTenant>`."
      );
    }
  } catch (e) {
    errors.push(`.mcp.json is not valid JSON: ${e.message}`);
  }
}
/* On ODC, OutSystems' official plugin is required: it carries the server and the skill. */
if ((cfg.environment ?? "ODC") === "ODC") {
  let settings = {};
  try { settings = JSON.parse(readFileSync(join(root, ".claude", "settings.json"), "utf8")); } catch {}
  if (
    settings.enabledPlugins?.["outsystems@outsystems"] !== true ||
    settings.extraKnownMarketplaces?.outsystems?.source?.repo !== "OutSystems/outsystems-mcp"
  ) {
    errors.push(
      ".claude/settings.json must enable OutSystems' official plugin on ODC: " +
        '"outsystems@outsystems": true in enabledPlugins, and the "outsystems" marketplace from ' +
        "OutSystems/outsystems-mcp in extraKnownMarketplaces."
    );
  }
}
const tenant = cfg.odcTenant;
const tenantSet = typeof tenant === "string" && tenant.trim() !== "" && !tenant.includes("<<");
const environment = cfg.environment ?? "ODC";
if (!["ODC", "O11"].includes(environment)) {
  errors.push(`environment is ${JSON.stringify(environment)} — must be "ODC" or "O11".`);
} else if (environment === "O11") {
  /* O11 has no tenant MCP endpoint; Service Studio's MCP server is per machine. A tenant here
   * would mean the config was copied from an ODC project, so say so rather than ignore it. */
  if (tenant != null) {
    errors.push(
      `environment is "O11" but odcTenant is ${JSON.stringify(tenant)}. O11 has no tenant MCP ` +
        "endpoint — set odcTenant to null (re-run `npm run init --environment=O11`)."
    );
  }
} else if (tenant === null) {
  notes.push("no OutSystems MCP (odcTenant is null) — handovers carry Mentor prompts, the ODC fallback.");
} else if (!tenantSet) {
  errors.push(
    'odcTenant is unset. Re-run `npm run init --odc-tenant=<tenant>.outsystems.dev`, or ' +
      "`--odc-tenant=none` if this project has no MCP access (handovers then carry Mentor prompts). " +
      "Do NOT guess it: a wrong tenant points every ODC call at somebody else's environment."
  );
}

/* ---- framework: whether the theme stacks on OutSystems UI ----------------------- */
const framework = cfg.framework ?? "outsystems-ui";
if (!["outsystems-ui", "none"].includes(framework)) {
  errors.push(
    `framework is ${JSON.stringify(framework)} — must be "outsystems-ui" (the theme redefines the ` +
      `framework's variables) or "none" (a standalone theme with no base theme).`
  );
} else if (framework === "none") {
  notes.push("framework is none — no OutSystems UI base under the specimens, the validator or the token audit.");
}

/* ---- modules: where the work lands, by role, valid for the platform ------------- */
const KINDS = { ODC: ["library", "app"], O11: ["CrossDevice", "ReactiveLibrary"] };
const REQUIRED_ROLES = ["theme", "patterns", "liveStyleGuide"];
if (cfg.modules && KINDS[environment]) {
  for (const role of REQUIRED_ROLES) {
    if (!cfg.modules[role]?.name) {
      errors.push(`modules.${role} is missing. Re-run \`npm run init\` — it asks for every module by role.`);
    }
  }
  for (const [role, m] of Object.entries(cfg.modules)) {
    if (role.startsWith("$") || !m || PLACEHOLDER_RE.test(m.name ?? "")) continue;
    if (!KINDS[environment].includes(m.kind)) {
      errors.push(
        `modules.${role}.kind is ${JSON.stringify(m.kind)} — on ${environment} it must be one of ` +
          `${KINDS[environment].join(" | ")}. Re-run \`npm run init --environment=${environment}\`.`
      );
    }
    if (environment === "O11" && !m.app) {
      errors.push(`modules.${role}.app is missing — on O11 every module names the application it ships in.`);
    }
  }
} else if (!cfg.modules && !cfg.odcThemeModule) {
  errors.push("project.config.json has no `modules`. Re-run `npm run init` to record where the work lands.");
}

/* ---- report --------------------------------------------------------------------- */
if (errors.length) {
  console.error(`\ncheck:config FAILED — ${errors.length} problem(s):\n`);
  errors.slice(0, 40).forEach((e) => console.error(`  ✗ ${e}`));
  if (errors.length > 40) console.error(`  … and ${errors.length - 40} more`);
  console.error(
    `\nThis gate is deliberate. An uninitialised template that silently "works" is how a wrong\n` +
      `class prefix ships into a real project.\n`
  );
  process.exit(1);
}

console.log(`check:config → ok (prefix "${cfg.classPrefix}", ${cfg.environment ?? "ODC"})`);
notes.forEach((n) => console.log(`  note: ${n}`));
