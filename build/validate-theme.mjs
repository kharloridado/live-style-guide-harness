#!/usr/bin/env node
/* validate-theme.mjs — make the deterministic gate actually deterministic.
 *
 * build-theme.mjs concatenates CSS and never parses it, so this is what makes
 * `npm run build:theme` exiting 0 mean the theme is sound. Two checks:
 *
 *   1. SYNTAX — parse the assembled theme with lightningcss. A parse error is a build
 *      failure, full stop.
 *   2. SCHEMA — every var(--token) reference resolves to a definition (or carries an
 *      explicit fallback). A dangling var() is silently invalid at runtime: the property
 *      just doesn't apply, and the component renders subtly wrong with no error anywhere.
 *
 * Usage:  node build/validate-theme.mjs      (runs as part of npm run build:theme) */
import { readFileSync, existsSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { root } from "./lib/project-config.mjs";
import { checkStructure } from "./lib/css-structure.mjs";

const themeFile = join(root, "dist", "theme.css");
const css = readFileSync(themeFile, "utf8");
const errors = [];

/* ---- 1a. structure: balanced braces + terminated comments ------------------------ */
const structural = checkStructure(css, "dist/theme.css");
if (structural) errors.push(`dist/theme.css is structurally broken: ${structural}`);

/* ---- 1b. syntax: parse it for real ----------------------------------------------- */
/* Call the lightningcss binary directly out of node_modules/.bin — going through `npx`
 * spawns unreliably on Windows (EINVAL), and a validator that errors on a HEALTHY tree is
 * worse than no validator at all: it trains you to ignore it.
 *
 * NO `--targets` in the argument list: a browserslist query like ">= 0.25%" contains `>=`,
 * which cmd.exe reads as a REDIRECTION operator — that mangled the command and failed a
 * perfectly healthy theme. Targets are a codegen concern; parsing is all we need here. */
const isWin = process.platform === "win32";

/* Prefer the REAL binary over the .bin shim on Windows. `cmd.exe /c` re-splits the
 * command line it is handed, so a shim path containing a space — as in
 * "…\US Web Design System\node_modules\.bin\lightningcss.cmd" — is torn in half and
 * cmd tries to execute "…\OutSystems\US", failing a perfectly healthy theme. That is
 * the same class of bug as the `--targets` redirection one above: cmd.exe parsing a
 * string we thought we had handed over as arguments.
 *
 * execFileSync on the .exe quotes correctly and never involves a shell at all. The shim
 * stays as a fallback, invoked with the whole command line as ONE verbatim argument,
 * double-quote-wrapped, which is the only spelling `cmd /s /c` parses correctly. */
const winExe = join(root, "node_modules", "lightningcss-cli", "lightningcss.exe");
const shim = join(root, "node_modules", ".bin", isWin ? "lightningcss.cmd" : "lightningcss");
const bin = isWin && existsSync(winExe) ? winExe : shim;

if (!existsSync(bin)) {
  console.warn(
    "validate:theme — lightningcss not installed, skipping the parse check (run `npm install`).\n" +
      "                 The structural and token-schema checks still ran."
  );
} else if (!structural) {
  const probe = join(root, "dist", ".validate-probe.css");
  // `cmd.exe /c` rather than { shell: true }: same effect, without Node's DEP0190 warning
  // firing on every single build.
  const viaShim = isWin && bin === shim;
  const [cmd, args] = viaShim
    ? ["cmd.exe", ["/d", "/s", "/c", `""${bin}" "${themeFile}" -o "${probe}""`]]
    : [bin, [themeFile, "-o", probe]];
  try {
    execFileSync(cmd, args, {
      stdio: ["ignore", "ignore", "pipe"],
      cwd: root,
      ...(viaShim ? { windowsVerbatimArguments: true } : {}),
    });
  } catch (err) {
    const detail = (err.stderr?.toString() || err.message).trim();
    errors.push(`dist/theme.css does not parse as valid CSS:\n\n${detail}`);
  } finally {
    rmSync(probe, { force: true });
  }
}

/* ---- 2. token schema ------------------------------------------------------------ */
/* Strip comments first: a commented-out example like `var(--not-real)` is not a usage. */
const code = css.replace(/\/\*[\s\S]*?\*\//g, "");

const defined = new Set([...code.matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1]));

/* …PLUS every token OutSystems UI itself declares.
 *
 * In ODC the theme is pasted below OutSystems UI, so the framework's custom properties are in
 * scope and block overrides are meant to consume them (`var(--space-s)`). Reading the compiled
 * base also catches a typo'd framework token (`--space-md`) — the same file the specimen pages
 * load, so the validator and the gate agree on what exists.
 *
 * If the base has not been compiled yet (`npm run build:osui`), any dangling reference is
 * reported as that one setup step rather than as undefined tokens.
 *
 * HARVEST SCOPE — `:root` / `html` / `body` ONLY, never "anywhere in the file".
 * OutSystems UI declares ~69 custom properties inside SCOPED rules that a theme-level
 * var() can never see: --osui-tooltip-background-color on .osui-tooltip,
 * --osui-carousel-track-width on the carousel track, --border-radius-sharp inside a
 * modifier block, and so on. Harvesting the whole file would let a theme rule write
 * `var(--osui-carousel-track-width)` — a reference that resolves to NOTHING at :root —
 * and the validator would call it fine. That is the exact silent-failure class this
 * check exists to catch, so the harvest is restricted to the selectors whose declarations
 * are genuinely inherited by every element the theme styles. A block override that needs
 * a scoped property must still spell out a fallback: var(--x, <value>). */
const osuiBase = join(root, "review", "vendor", "outsystems-ui", "outsystems-ui.css");
if (existsSync(osuiBase)) {
  const base = readFileSync(osuiBase, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  /* Selector list must consist ONLY of :root / html / body (with optional pseudo-classes
   * such as :root:not(.x) or html[dir=rtl]); one scoped selector in the list and the
   * whole block is skipped, because the declarations then only apply under that scope. */
  const GLOBAL_SELECTOR = /^(?::root|html|body)(?:\[[^\]]*\]|:[\w-]+(?:\([^)]*\))?)*$/;
  for (const m of base.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selectors = m[1].split(",").map((s) => s.trim()).filter(Boolean);
    if (!selectors.length || !selectors.every((s) => GLOBAL_SELECTOR.test(s))) continue;
    for (const d of m[2].matchAll(/(--[\w-]+)\s*:/g)) defined.add(d[1]);
  }
}

/* A usage only counts as dangling when it has NO fallback — `var(--x, 8px)` is a
 * documented fallback chain and is legitimate (Web Components rely on it). */
const dangling = new Map();
for (const m of code.matchAll(/var\(\s*(--[\w-]+)\s*([,)])/g)) {
  const [, name, next] = m;
  if (next === ")" && !defined.has(name)) {
    const line = code.slice(0, m.index).split("\n").length;
    if (!dangling.has(name)) dangling.set(name, line);
  }
}

if (dangling.size && !existsSync(osuiBase)) {
  errors.push(
    `${dangling.size} token reference(s) cannot be checked: the OutSystems UI base is not built.\n\n` +
      `    review/vendor/outsystems-ui/outsystems-ui.css is missing, so tokens the framework owns\n` +
      `    (--space-m, --color-neutral-0, …) look undefined. Build it once per clone, then re-run:\n\n` +
      `      git submodule update --init vendor/outsystems-ui && npm run build:osui`
  );
} else if (dangling.size) {
  const list = [...dangling.entries()]
    .slice(0, 15)
    .map(([name, line]) => `      ${name}  (first used at dist/theme.css:${line})`)
    .join("\n");
  errors.push(
    `${dangling.size} token reference(s) resolve to nothing and have no fallback:\n\n${list}` +
      `${dangling.size > 15 ? `\n      … and ${dangling.size - 15} more` : ""}\n\n` +
      `    A dangling var() fails silently at runtime — the declaration is simply dropped and the\n` +
      `    component renders subtly wrong with no error. Define the token, or give the reference an\n` +
      `    explicit fallback:  var(--x, <value>).`
  );
}

/* ---- report ---------------------------------------------------------------------- */
if (errors.length) {
  console.error(`\nvalidate:theme FAILED — the deterministic gate is a hard wall.\n`);
  errors.forEach((e) => console.error(`  ✗ ${e}\n`));
  process.exit(1);
}

console.log(`validate:theme → ok (${defined.size} tokens defined, all references resolve)`);
