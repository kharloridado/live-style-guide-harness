#!/usr/bin/env node
/* check-stylesheets.mjs — structural guard for every hand-written stylesheet.
 *
 * dist/theme.css is checked after assembly; this checks the files people and agents merge by
 * hand, so a stray brace is caught at its origin (see build/lib/css-structure.mjs).
 *
 * Scope: src/blocks/*.css, src/components/*.css, build/review/*.css (the specimen chrome) and
 * tokens/*.css. Everything a person edits, plus the token sources the theme is built from,
 * so a stray brace is caught at its origin rather than after assembly.
 *
 * Usage: node build/check-stylesheets.mjs      (runs in CI, and before build:theme) */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, relative } from "node:path";
import { root } from "./lib/project-config.mjs";
import { checkStructure } from "./lib/css-structure.mjs";

const DIRS = [
  "tokens",
  "src/blocks",
  "src/components",
  "build/review",
];

const files = [];
for (const dir of DIRS) {
  const abs = join(root, dir);
  if (!existsSync(abs)) continue;
  for (const name of readdirSync(abs)) {
    if (name.endsWith(".css")) files.push(join(abs, name));
  }
}

const problems = [];
for (const file of files) {
  const rel = relative(root, file).replace(/\\/g, "/");
  const problem = checkStructure(readFileSync(file, "utf8"), rel);
  if (problem) problems.push(problem);
}

if (problems.length) {
  console.error("\ncheck:stylesheets FAILED — a stylesheet is structurally broken.\n");
  for (const p of problems) console.error(`  ✗ ${p}`);
  console.error(
    "\n  This is not a style nit. An unclosed rule is not a syntax error: the parser reads\n" +
    "  everything after it as declarations of that rule, drops them, and reports nothing.\n" +
    "  The stylesheet still loads and still has rules — it is just missing the ones that\n" +
    "  were swallowed, so the page renders wrong with no error anywhere.\n\n" +
    "  It is almost always a merge conflict resolved across a rule boundary. Find the\n" +
    "  block named above and close it.\n"
  );
  process.exit(1);
}

console.log(`check:stylesheets → ok (${files.length} stylesheet(s), all blocks closed)`);
