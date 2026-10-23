#!/usr/bin/env node
/* build/token-reference.mjs — writes specs/tokens/token-reference.md: every custom property
 * theme and block CSS can use, its resolved value, where it comes from, and when to use it.
 *
 * The set is closed: the framework's own :root/html/body variables, as redefined by
 * dist/theme.css, plus the <classPrefix>* tokens the theme adds. Generated — edit tokens/, not the file.
 *
 *   npm run specs:tokens            write it
 *   npm run specs:tokens -- --check exit 1 if the committed file is stale (used by sync) */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { projectConfig, root, usesOutSystemsUI } from './lib/project-config.mjs';

const OSUI = usesOutSystemsUI() ? 'review/vendor/outsystems-ui/outsystems-ui.css' : null;
const THEME = 'dist/theme.css';
const OUT = 'specs/tokens/token-reference.md';

/* The project's own token prefix, for the families where it adds what the framework lacks. */
const P = projectConfig().classPrefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const own = (rest) => new RegExp('^--' + P + rest);

const FAMILIES = [
  ['Colour — brand and neutral', /^--color-(?:primary|secondary|neutral)/, 'Text, fills and borders. Primary is the action colour; the neutral ramp darkens 0 → 10 and framework widgets pick steps by number. Check contrast in specs/foundations/color.md before pairing two.'],
  ['Colour — semantic', /^--color-(?:error|success|warning|info|focus)/, 'State only: validation, alerts, focus. Never decoration.'],
  ['Colour — ramps', /^--color-[a-z]+-(?:lightest|lighter|light|dark|darker|darkest)$|^--color-(?:red|orange|yellow|lime|green|teal|cyan|blue|indigo|violet|grape|pink)$/, 'Tints and shades of each hue. Use when a ref binds one by name; otherwise prefer brand, neutral or semantic.'],
  ['Colour — surfaces and roles', /^--color-|^--overlay/, 'Page and component backgrounds, and the framework\'s role aliases.'],
  ['Spacing', { test: (n) => /^--(?:space|units)-/.test(n) || own('space-').test(n) }, 'padding, margin, gap, inset. The scale is the framework\'s. A value between steps has no token: build it as drawn and raise a design-token finding.'],
  ['Typography', { test: (n) => /^--font-|^--line-height/.test(n) || own('font-').test(n) || own('line-height-').test(n) }, 'font-size, font-weight, font-family, line-height. Sizes and weights are the framework\'s; the project prefix adds only what OutSystems UI lacks.'],
  ['Radius', { test: (n) => /^--(?:border-radius|radius)-/.test(n) || own('border-radius-').test(n) }, 'border-radius. --border-radius-circle is 100%, which is round only on a square box.'],
  ['Border size', /^--border-size-/, 'border-width and outline-width.'],
  ['Shadow', /^--shadow-/, 'box-shadow. Several steps are bound in the mockups; use the one the ref names.'],
  ['Layers', /^--(?:layer|z-index)-/, 'z-index. Local tiers for stacking inside a component, global tiers for overlays.'],
  ['Layout', /^--(?:header|side|bottom|footer)-|^--os-|^--osui-(?:bottom|sidebar|menu|popup|notification)/, 'Framework layout dimensions. Read, rarely override.'],
  ['Icons', /^--osui-icon/, 'The framework\'s icon glyph variables.'],
  ['Other', /./, ''],
];

function harvest(css) {
  const out = [];
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, ' '));
  for (const m of clean.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const sels = m[1].split(',').map((s) => s.trim());
    if (!sels.every((s) => /^(?::root|html|body)$/.test(s))) continue;
    for (const d of m[2].matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) out.push([d[1], d[2].trim().replace(/\s+/g, ' '), m.index + m[0].indexOf(d[0], m[1].length)]);
  }
  return out;
}

/* A theme declaration's trailing comment, e.g. `/* brand navy - framework: #1068eb *\/`. */
function notesFrom(css) {
  const notes = new Map();
  for (const m of css.matchAll(/(--[\w-]+)\s*:[^;]+;[ \t]*\/\*\s*([^*]*?)\s*\*\//g)) notes.set(m[1], m[2].replace(/\|/g, '\\|'));
  return notes;
}

function build() {
  for (const p of [OSUI, THEME]) if (p && !existsSync(join(root, p))) throw new Error(`${p} is missing — run ${OSUI ? 'npm run build:osui and ' : ''}npm run build:theme`);
  const themeCss = readFileSync(join(root, THEME), 'utf8');
  const tokens = new Map();
  if (OSUI) for (const [name, value] of harvest(readFileSync(join(root, OSUI), 'utf8'))) tokens.set(name, { value, framework: value, source: 'OutSystems UI' });
  for (const [name, value] of harvest(themeCss)) {
    const t = tokens.get(name);
    tokens.set(name, t ? { ...t, value, source: value === t.framework ? 'OutSystems UI' : 'Theme (redefined)' } : { value, source: 'Theme (added)' });
  }
  const notes = notesFrom(themeCss);
  const cfg = projectConfig();
  const groups = FAMILIES.map(([title, re, use]) => ({ title, re, use, rows: [] }));
  for (const [name, t] of [...tokens].sort(([a], [b]) => a.localeCompare(b, 'en', { numeric: true }))) {
    /* A standalone theme prefixes every token (`--<prefix>color-primary`): group it by the name after the prefix. */
    const bare = OSUI ? name : name.replace(own(''), '--');
    groups.find((g) => g.re.test(bare)).rows.push([name, t]);
  }
  const redefined = [...tokens.values()].filter((t) => t.source !== 'OutSystems UI').length;
  const model = OSUI
    ? `There is no alias layer. OutSystems UI's own variables are the tokens; \`tokens/*.css\` redefines the
ones this brand changes, and the theme loads after the framework, so the redefinition wins everywhere
the framework uses the name. \`--${cfg.classPrefix}*\` exists only for what the framework has no variable for.`
    : `There is no framework underneath (\`framework: "none"\`): \`tokens/*.css\` declares every token, and
nothing else defines a custom property the theme can use.`;
  let md = `# Token reference — ${cfg.designSystemName}

> Generated by \`npm run specs:tokens\` from \`${THEME}\`${OSUI ? ' over the compiled OutSystems UI base' : ''}.
> Do not edit: change \`tokens/\`, rebuild, regenerate.

The closed set of values UI code may use: **${tokens.size} tokens**, ${redefined} of them set by this theme.
Every visual value in \`src/\` is \`var(--one-of-these)\`. \`npm run audit:tokens\` fails on anything else.

${model}

A value the design needs and no token holds is **built as drawn and raised as a finding**, never
rounded to the nearest token and never minted as a one-off token.
`;
  for (const g of groups) {
    if (!g.rows.length) continue;
    md += `\n## ${g.title}\n\n${g.use ? g.use + '\n\n' : ''}| Token | Value | Source | Notes |\n|---|---|---|---|\n`;
    for (const [name, t] of g.rows) {
      const note = notes.get(name) || (t.source === 'Theme (redefined)' ? `framework: \`${t.framework}\`` : '');
      md += `| \`${name}\` | \`${t.value.replace(/\|/g, '\\|')}\` | ${t.source} | ${note} |\n`;
    }
  }
  return md;
}

const md = build();
if (process.argv.includes('--check')) {
  const current = existsSync(join(root, OUT)) ? readFileSync(join(root, OUT), 'utf8') : '';
  if (current.replace(/\r\n/g, '\n') !== md) { console.log(`${OUT} is stale — run npm run specs:tokens`); process.exit(1); }
  console.log(`${OUT} is current`);
} else {
  writeFileSync(join(root, OUT), md);
  console.log(`specs:tokens → ${OUT}`);
}
