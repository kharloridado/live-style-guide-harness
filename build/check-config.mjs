#!/usr/bin/env node
/* check-config.mjs — the guard that makes template drift impossible.
 *
 * Runs as the first step of `npm run build:theme`, which means it sits inside the
 * @checker's DETERMINISTIC GATE. A project that has not been initialised, or that has
 * leaked the template's own example values into real code, cannot build — and therefore
 * cannot pass review.
 *
 * It exists because the last generation of this template shipped a plausible-looking
 * example prefix (`rnt-`) and a plausible-looking spacing base (`4pt`). Both were wrong.
 * The prefix silently contradicted itself across two config files for the life of the
 * project; the spacing base manufactured a batch of false-positive findings. Neither
 * failed anything loudly, so neither got caught.
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

/* ---- 3. conventions must be three-state, and only `confirmed` is a rule --------- */
for (const [name, c] of Object.entries(cfg.conventions ?? {})) {
  if (name === "$comment") continue;
  if (!c || typeof c !== "object" || !("status" in c)) {
    errors.push(
      `conventions.${name} must be an object with a "status" of confirmed | assumed | TBD — ` +
        `never a bare value. An unverified convention that looks like a rule is how false-positive findings get manufactured.`
    );
    continue;
  }
  if (!["confirmed", "assumed", "TBD"].includes(c.status)) {
    errors.push(`conventions.${name}.status is "${c.status}" — must be confirmed | assumed | TBD.`);
  }
  if (c.status === "confirmed" && (c.value === null || c.value === undefined)) {
    errors.push(`conventions.${name} is marked "confirmed" but has no value. Confirm it properly or set status back to TBD.`);
  }
}

/* ---- 4b. the platform-knowledge pack must actually be on disk ------------------- */
/* The outsystems-loop skills hold no OutSystems platform knowledge — no block catalog, no
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
    `"vendored-copy". See ARCHITECTURE.md in the outsystems-loop plugin.`
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
  const isExampleDoc = /(^|\/)(EXAMPLE-|MENTOR-STUDIO-PROMPT|README|LESSONS|CHANGELOG)/i.test(rel);
  const text = readFileSync(path, "utf8");

  text.split("\n").forEach((line, i) => {
    if (PLACEHOLDER_RE.test(line) && !isExampleDoc) {
      errors.push(`${rel}:${i + 1} — unfilled placeholder ${line.match(PLACEHOLDER_RE)[0]}`);
    }
    // Real code must never carry the example prefix — that's the `rnt-` leak, exactly.
    if (line.includes(EXAMPLE_PREFIX) && !isExampleDoc && /^(tokens|src|specs|build\/review)\//.test(rel)) {
      errors.push(`${rel}:${i + 1} — the template's example prefix "${EXAMPLE_PREFIX}" leaked into real code`);
    }
  });
}

SCAN_DIRS.forEach((d) => walk(join(root, d)));

/* ---- ODC tenant: project.config.json and .mcp.json must agree ------------------- */
/* This is the one project value that is deliberately duplicated, because the harness
 * reads .mcp.json before any build script runs. Duplication is only safe when something
 * checks it, so the drift check lives here — inside the checker's deterministic gate. */
const MCP_PATH = join(root, ".mcp.json");
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
} else if (!tenantSet) {
  errors.push(
    'odcTenant is unset. Re-run `npm run init --odc-tenant=<tenant>.outsystems.dev`. ' +
      "Do NOT guess it: a wrong tenant points every ODC call at somebody else's environment."
  );
} else if (!existsSync(MCP_PATH)) {
  errors.push(`odcTenant is "${tenant}" but .mcp.json does not exist. Re-run \`npm run init\` to generate it.`);
} else {
  let mcpUrl = null;
  try {
    mcpUrl = JSON.parse(readFileSync(MCP_PATH, "utf8"))?.mcpServers?.outsystems?.url ?? null;
  } catch (e) {
    errors.push(`.mcp.json is not valid JSON: ${e.message}`);
  }
  const expected = `https://${tenant}/mcp`;
  if (mcpUrl && mcpUrl !== expected) {
    errors.push(
      `.mcp.json points at ${mcpUrl} but project.config.json says ${expected}. ` +
        "Re-run `npm run init` rather than hand-editing .mcp.json."
    );
  } else if (!mcpUrl) {
    errors.push(".mcp.json has no mcpServers.outsystems.url. Re-run `npm run init` to generate it.");
  }
}

/* ---- report --------------------------------------------------------------------- */
if (errors.length) {
  console.error(`\ncheck:config FAILED — ${errors.length} problem(s):\n`);
  errors.slice(0, 40).forEach((e) => console.error(`  ✗ ${e}`));
  if (errors.length > 40) console.error(`  … and ${errors.length - 40} more`);
  console.error(
    `\nThis gate is deliberate. An uninitialised template that silently "works" is how a wrong\n` +
      `class prefix or an unverified convention ships into a real project.\n`
  );
  process.exit(1);
}

const confirmed = Object.entries(cfg.conventions ?? {})
  .filter(([k, c]) => k !== "$comment" && c?.status === "confirmed")
  .map(([k]) => k);
console.log(
  `check:config → ok (prefix "${cfg.classPrefix}", ${confirmed.length} confirmed convention(s)` +
    `${confirmed.length ? `: ${confirmed.join(", ")}` : "; none confirmed — no grid/spacing rules will be enforced"})`
);
