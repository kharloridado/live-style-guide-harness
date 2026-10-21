#!/usr/bin/env node
/* build-theme.mjs — assembles dist/theme.css from tokens/*.css.
 *
 * Sectioning follows the OutSystems UI convention (see ODC.OutSystemsUI.scss):
 * a `/*!` header, a numbered "Section Index", and `/*! ===…=== *\/` banners per
 * section. `!` marks the comments as important so they survive minification.
 *
 * Comment-PRESERVING by design: lightningcss strips every comment, which leaves
 * the pasted ODC theme an unreadable wall of variables. This build keeps the
 * source provenance/finding notes AND adds the navigable index.
 *
 * `--ship` (customer deliverable): strips the ordinary `/* … *\/` provenance and
 * finding notes but KEEPS the `/*!` important comments — the head, the Section
 * Index, and the per-section banners. The pasted ODC theme stays navigable
 * (TOC + sectioning) without the internal working notes.
 *
 * SINGLE :root — every token file declares its own `:root { … }`; concatenating
 * them verbatim would emit many `:root` blocks. Instead we lift each file's
 * declarations into ONE consolidated `:root { … }` (section banners kept as inner
 * comments). Files with no `:root` (e.g. the color utility CLASSES) are emitted
 * after the consolidated block, each under its own banner.
 *
 * Usage:  node build/build-theme.mjs [--watch] [--ship]
 * Order of sections follows the @import order in tokens/index.css. */
import { readFileSync, writeFileSync, mkdirSync, watch } from "node:fs";
import { dirname, join } from "node:path";
import { projectConfig, root } from "./lib/project-config.mjs";

const cfg = projectConfig();
const tokensDir = join(root, "tokens");
const blocksDir = join(root, "src", "blocks");
const outFile = join(root, "dist", "theme.css");

/* The version stamped at the top of dist/theme.css; set by `npm run release`. */
const version = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version;

/* Per-file section metadata — SELF-DECLARED, read from the file itself.
 *
 * Each token / block CSS file names its own place in the Section Index with an
 * `@section` annotation in a comment near the top:
 *
 *     /* @section Colors / Primitives *\/
 *      ^ group ── ^ name (optional; omit for a single-file group)
 *
 * `group` clusters files under one top-level number; `name` is the sub-entry when a
 * group holds more than one file. Self-declared so a new file needs no registration here. */
const SECTION_RE = /@section\s+([^\n*/]+?)\s*(?:\/\s*([^\n*/]+?))?\s*(?:\*\/|\n)/;
const metaCache = new Map();

/* Set once per build(): tells meta() which directory a given file came from. */
let dirOf = () => tokensDir;

function meta(file) {
  if (metaCache.has(file)) return metaCache.get(file);
  let m = null;
  try {
    m = SECTION_RE.exec(readFileSync(join(dirOf(file), file), "utf8"));
  } catch { /* unreadable — fall through to the Misc default */ }
  const info = m
    ? { group: m[1].trim(), name: (m[2] ?? m[1]).trim() }
    : { group: "Misc", name: file };
  if (!m) console.warn(`build:theme — ${file} has no  /* @section Group / Name */  header; filed under "Misc".`);
  metaCache.set(file, info);
  return info;
}

/* The @section marker is build metadata, not documentation — the emitted banner already
 * states the section. Drop it from the shipped theme so it doesn't read as a stray note.
 * Handles both a standalone `/* @section … *\/` line and one opening a longer comment. */
function stripSectionMarker(s) {
  return s
    .replace(/^[ \t]*\/\*[ \t]*@section[^\n]*?\*\/[ \t]*\r?\n/, "")
    .replace(/^([ \t]*\/\*)[ \t]*@section[^\n]*(\r?\n)/, "$1$2");
}

const RULE = "=".repeat(78); // section-banner rule width (OutSystems UI style)

/* External `@import url(...)` (e.g. Google Fonts) must sit at the very top of the
 * stylesheet — CSS ignores @import after any other rule. Token files declare them
 * inline (next to the related tokens); the build lifts them out and hoists them
 * above the head banner. Matches http(s) imports only — local `@import "./x"` is
 * resolved by importOrder(), not hoisted. */
const HOIST_IMPORT_RE = /^[ \t]*@import\s+url\(["']?https?:\/\/[^)]+\);[ \t]*\n?/gim;

function extractHoistedImports(body) {
  const imports = [];
  const stripped = body.replace(HOIST_IMPORT_RE, (m) => {
    imports.push(m.trim());
    return "";
  });
  return { stripped, imports };
}

function importOrder() {
  const index = readFileSync(join(tokensDir, "index.css"), "utf8");
  const files = [];
  const re = /@import\s+["']\.\/([^"']+)["']/g;
  let m;
  while ((m = re.exec(index))) files.push(m[1]);
  return files;
}

function blocksOrder() {
  const index = readFileSync(join(blocksDir, "index.css"), "utf8");
  const files = [];
  const re = /@import\s+["']\.\/([^"']+)["']/g;
  let m;
  while ((m = re.exec(index))) files.push(m[1]);
  return files;
}

function banner(title) {
  return `/*! ${RULE}\n${title}\n${RULE} */`;
}

/* `--ship` post-process: drop every ordinary `/* … *\/` note, KEEP the `/*!`
 * important comments (head, Section Index, section banners), then tidy the blank
 * lines and trailing whitespace those notes leave behind.
 *
 * A comment-aware scanner, NOT a regex: a `/*!` comment's own BODY may contain the
 * literal `/*` (e.g. the head's "tokens/*.css"), and since CSS comments don't nest,
 * a comment runs from `/*` to the NEXT `*\/`. Scanning for `*\/` from the opener —
 * never re-scanning the body for `/*` — keeps such comments whole; a regex that
 * hunts for `/*` mid-body would slice the keep-comment apart. */
function stripNotes(css) {
  let out = "";
  for (let i = 0; i < css.length; ) {
    if (css[i] === "/" && css[i + 1] === "*") {
      const keep = css[i + 2] === "!";
      const end = css.indexOf("*/", i + 2);
      const stop = end === -1 ? css.length : end + 2;
      if (keep) out += css.slice(i, stop);
      i = stop; // ordinary comment: skip it entirely
    } else {
      out += css[i++];
    }
  }
  return out
    .replace(/[ \t]+$/gm, "") // trim trailing whitespace
    .replace(/\n{3,}/g, "\n\n") // collapse blank-line runs to one
    .replace(/^\n+/, ""); // no leading blank lines
}

/* Group files by their declared @section group, preserving first-seen order. Returns
 * the ordered group list + a group→files map, used for the N / N.M numbering. */
function groupFiles(files) {
  const order = [];
  const map = new Map();
  for (const file of files) {
    const { group } = meta(file);
    if (!map.has(group)) {
      map.set(group, []);
      order.push(group);
    }
    map.get(group).push(file);
  }
  return { order, map };
}

/* `N` for a single-file group, `N.M` for a file inside a multi-file group. */
function sectionNumber({ order, map }, file) {
  const n = order.indexOf(meta(file).group) + 1;
  const list = map.get(meta(file).group);
  return list.length === 1 ? `${n}` : `${n}.${list.indexOf(file) + 1}`;
}

/* Banner title: the group name for single-file groups, else the file's own name. */
function sectionTitle(groups, file) {
  const { group, name } = meta(file);
  return groups.map.get(group).length === 1 ? group : name;
}

function buildIndex({ order, map }) {
  const lines = ["/*!", "Section Index:"];
  order.forEach((group, i) => {
    const n = i + 1;
    const list = map.get(group);
    lines.push(`${n}. ${group}`);
    if (list.length > 1) {
      list.forEach((file, j) => lines.push(`    ${n}.${j + 1}. ${meta(file).name}`));
    }
  });
  lines.push("*/");
  return lines.join("\n");
}

/* Index of the first `{` that is NOT inside a `/* … *\/` comment, or -1. Used to
 * tell a real rule (e.g. an @font-face block) from prose in a file's preamble. */
function firstRuleBrace(s) {
  for (let i = 0; i < s.length; i++) {
    if (s[i] === "/" && s[i + 1] === "*") {
      const end = s.indexOf("*/", i + 2);
      if (end === -1) break;
      i = end + 1; // skip the comment (loop's i++ lands past the `/`)
      continue;
    }
    if (s[i] === "{") return i;
  }
  return -1;
}

/* Index of the brace that CLOSES the `:root {` opened at `open` (the position of
 * its `{`), found by brace-counting and skipping `/* … *\/` comments. Returns -1
 * if unbalanced. Must NOT assume it's the file's last `}` — a file may carry
 * trailing top-level rules after its :root (e.g. typography.css's `html, body` +
 * `body.phone` responsive blocks). */
function matchingBrace(s, open) {
  let depth = 0;
  for (let i = open; i < s.length; i++) {
    if (s[i] === "/" && s[i + 1] === "*") {
      const end = s.indexOf("*/", i + 2);
      if (end === -1) return -1;
      i = end + 1;
      continue;
    }
    if (s[i] === "{") depth++;
    else if (s[i] === "}" && --depth === 0) return i;
  }
  return -1;
}

/* Split a file body into its leading `:root { … }` declaration block and anything
 * outside it. The inner = between the first `{` after `:root` and that block's OWN
 * matching `}` (not the file's last `}`); the preamble (the provenance/header
 * comment) is kept and re-emitted inside the merged block.
 * Files with no `:root` return inner:null and are emitted as standalone sections.
 *
 * `hoist`: real CSS that sits BEFORE the `:root` (e.g. typography.css's @font-face
 * rules). It must stay at TOP LEVEL — nesting an at-rule like @font-face inside the
 * consolidated :root is invalid CSS and silently breaks every token below it. When
 * the preamble contains a rule (a brace outside comments) we hoist the whole
 * pre-:root chunk out rather than folding it inside.
 *
 * `trailing`: real CSS that sits AFTER the `:root` close (e.g. typography.css's
 * `html, body` base rule + `body.tablet`/`body.phone` responsive overrides). Like
 * `hoist`, it must stay TOP LEVEL — folding it into the consolidated :root nests the
 * downstream component tokens inside `body.phone`, so they only apply on phones.
 * */
function splitRoot(body) {
  // Match `:root {` as an actual SELECTOR (optional whitespace before the brace),
  // not the bare word ":root" — a class-only override file may mention ":root" in
  // its prose comments (e.g. "which only retints the :root --color-* vars"), and a
  // naive indexOf(":root") would mis-slice it into the consolidated :root block,
  // leaving it unclosed and breaking every token.
  const m = /:root\s*\{/.exec(body);
  if (!m) return { preamble: "", hoist: "", inner: null, trailing: "" };
  const open = m.index + m[0].length - 1; // position of the matched `{`
  const matched = matchingBrace(body, open);
  const close = matched === -1 ? body.lastIndexOf("}") : matched;
  const before = body.slice(0, m.index).trimEnd();
  const hasRule = firstRuleBrace(before) !== -1;
  return {
    preamble: hasRule ? "" : before,
    hoist: hasRule ? before : "",
    inner: body.slice(open + 1, close).replace(/^\n+/, "").trimEnd(),
    trailing: body.slice(close + 1).trim(),
  };
}

function build() {
  const tokenFiles = importOrder();
  const blockFiles = blocksOrder();
  const files = [...tokenFiles, ...blockFiles];
  metaCache.clear(); // --watch: a file's @section header may have changed
  dirOf = (file) => (blockFiles.includes(file) ? blocksDir : tokensDir);
  const groups = groupFiles(files);
  const stamp = new Date().toISOString().slice(0, 10);
  const head = [
    "/*!",
    `${cfg.customer} · "${cfg.designSystemName}" Design System — Theme`,
    `Version ${version} · built ${stamp}   (see CHANGELOG.md)`,
    "Generated from tokens/*.css — do not edit directly. Rebuild: npm run build:theme.",
    "Paste the contents below into the ODC Theme editor.",
    "*/",
    "",
    buildIndex(groups),
  ].join("\n");

  const preRootSections = []; // top-level rules that must precede :root (e.g. @font-face)
  const rootSections = []; // declarations lifted into the single consolidated :root
  const tailSections = []; // files with no :root (e.g. utility classes, block overrides)
  const hoisted = [];      // external @import url() lines, lifted to the top
  for (const file of files) {
    const title = `${sectionNumber(groups, file)}. ${sectionTitle(groups, file)}`;
    const raw = stripSectionMarker(readFileSync(join(dirOf(file), file), "utf8")).trimEnd();
    const { stripped, imports } = extractHoistedImports(raw);
    hoisted.push(...imports);
    const body = stripped.trimEnd();
    const { preamble, hoist, inner, trailing } = splitRoot(body);
    // Pre-:root rules (e.g. @font-face) carry their own explanatory comment; emit
    // them at top level so they are valid CSS, not buried inside the merged :root.
    if (hoist) preRootSections.push(`${banner(title)}\n\n${hoist}`);
    if (inner === null) {
      tailSections.push(`${banner(title)}\n\n${body}`);
    } else {
      const parts = [banner(title)];
      if (preamble) parts.push(preamble);
      parts.push(inner);
      rootSections.push(parts.join("\n\n"));
    }
    // Post-:root rules (e.g. typography.css's `html, body` + `body.phone` responsive
    // blocks) must also stay top level — folding them into the merged :root nests
    // every later component token inside `body.phone`. Emit after the consolidated root.
    if (trailing) tailSections.push(`${banner(title)}\n\n${trailing}`);
  }
  const rootBlock = `:root {\n${rootSections.join("\n\n\n")}\n}`;

  // Dedupe hoisted imports (first occurrence wins) and place them above everything.
  const importBlock = [...new Set(hoisted)].join("\n");
  const docHead = importBlock ? `${importBlock}\n\n\n${head}` : head;

  const ship = process.argv.includes("--ship");
  let out = [docHead, ...preRootSections, rootBlock, ...tailSections].join("\n\n\n") + "\n";
  if (ship) out = stripNotes(out);

  mkdirSync(dirname(outFile), { recursive: true });
  writeFileSync(outFile, out);
  console.log(
    `build:theme${ship ? ":ship" : ""} → dist/theme.css (${hoisted.length ? "1 @import, " : ""}${preRootSections.length ? `${preRootSections.length} pre-root, ` : ""}1 :root, ${rootSections.length} token sections, ${tailSections.length} class sections${ship ? "; notes stripped, TOC + banners kept" : ""})`
  );
}

build();

if (process.argv.includes("--watch")) {
  console.log("watching tokens/ and src/blocks/ …");
  let timer;
  const rebuild = () => { clearTimeout(timer); timer = setTimeout(build, 50); };
  watch(tokensDir, rebuild);
  watch(blocksDir, rebuild);
}
