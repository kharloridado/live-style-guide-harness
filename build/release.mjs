#!/usr/bin/env node
/* release.mjs — the mechanical half of cutting a release.
 *
 *   npm run release -- patch | minor | <x.y.z>
 *
 * 1. refuses when CHANGELOG.md has nothing under ## [Unreleased]
 * 2. bumps package.json + package-lock.json (npm version --no-git-tag-version)
 * 3. moves the Unreleased notes under ## [x.y.z] — YYYY-MM-DD
 * 4. builds the ship theme, checks its head names the new version, and keeps it as
 *    dist/theme-x.y.z.css — the file pasted into ODC
 * 5. packages the ODC docs and records them as imported
 * 6. rebuilds the annotated dev copy of dist/theme.css
 *
 * It does not write the release summary, commit, tag or publish: it prints those steps.
 * Exit: 0 ok · 1 refused or a step failed */
import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { root } from "./lib/project-config.mjs";

const bump = process.argv[2];
if (!/^(patch|minor|major|\d+\.\d+\.\d+)$/.test(bump ?? "")) {
  console.error("usage: npm run release -- patch | minor | <x.y.z>\n  0.x: minor for a new component or tier, patch for fixes.");
  process.exit(1);
}

const CHANGELOG = join(root, "CHANGELOG.md");
const log = readFileSync(CHANGELOG, "utf8");
const unreleased = log.match(/^## \[Unreleased\][^\n]*\n([\s\S]*?)(?=^## \[|(?![\s\S]))/m);
if (!unreleased) fail("CHANGELOG.md has no `## [Unreleased]` heading.");
if (!unreleased[1].trim()) fail("Nothing under `## [Unreleased]` in CHANGELOG.md — there is nothing to release.");

const dirty = sh("git", ["status", "--porcelain"], { quiet: true }).stdout.trim();
if (dirty) console.warn(`release — the working tree has uncommitted changes; they will ride along:\n${dirty}\n`);

step("bump the version", "npm", ["version", bump, "--no-git-tag-version"]);
const version = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version;

const date = new Date().toISOString().slice(0, 10);
writeFileSync(CHANGELOG, log.replace(/^## \[Unreleased\][^\n]*\n\n?/m, `## [Unreleased]\n\n## [${version}] — ${date}\n\n`));
console.log(`release — CHANGELOG.md: Unreleased notes moved under [${version}] — ${date}`);

step("build the ship theme", "npm", ["run", "--silent", "build:theme:ship"]);
const theme = join(root, "dist", "theme.css");
const head = readFileSync(theme, "utf8").slice(0, 2000);
if (!head.includes(`Version ${version}`)) fail(`dist/theme.css does not name Version ${version} in its header.`);
const shipped = join(root, "dist", `theme-${version}.css`);
copyFileSync(theme, shipped);
console.log(`release — dist/theme-${version}.css is the ODC paste`);

step("package the ODC docs", "node", ["build/odc-docs.mjs"]);
step("record the ODC docs as imported", "node", ["build/odc-docs.mjs", "--record"]);
step("restore the dev theme", "npm", ["run", "--silent", "build:theme"]);

const changedZip = join("dist", `odc-docs-${version}-changed.zip`);
console.log(`
release v${version} prepared. Still to do, in order:

  1. Under "## [${version}] — ${date}" in CHANGELOG.md, write one short paragraph for the person
     pasting into ODC: what they will see change and what to re-paste.
  2. Import ${existsSync(join(root, changedZip)) ? changedZip : "nothing (no docs changed)"} into the theme module's Resources.
  3. npm run review, and republish the library review Artifact to its URL.
  4. Commit "release: v${version}" — package.json, package-lock.json, CHANGELOG.md,
     handover/odc-docs-imported.json — and open the release PR.
  5. After it merges: tag v${version} and create the GitHub release, attaching
     dist/theme-${version}.css and dist/odc-docs-${version}*.zip.
`);

function step(label, cmd, args) {
  const r = sh(cmd, args);
  if (r.status !== 0) fail(`${label} failed (${cmd} ${args.join(" ")}).`);
}

function sh(cmd, args, { quiet = false } = {}) {
  return spawnSync(cmd, args, {
    cwd: root,
    encoding: "utf8",
    stdio: quiet ? "pipe" : "inherit",
    shell: process.platform === "win32",
  });
}

function fail(msg) {
  console.error(`\nrelease FAILED — ${msg}\n`);
  process.exit(1);
}
