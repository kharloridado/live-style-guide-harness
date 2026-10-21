#!/usr/bin/env node
/* build/token-audit.mjs — every visual value in delivered CSS must be a token.
 *
 * Scans src/blocks/*.css, src/components/*.css and src/lsg/*.css. For each hard-coded value it
 * prints the file, line, value and the token of the same family that holds the same value, if one
 * does. tokens/ is not scanned: that is where literals belong.
 *
 *   error    a colour, spacing, font-size, font-weight, radius, shadow or z-index literal
 *   warning  a raw duration, or a length on a property with no token scale (width, height…)
 *
 * A literal the design demands and no token holds is built as drawn and raised as a finding
 * (CLAUDE.md). A comment naming that finding (FND-NNN) or the frozen-ref section that
 * authorises the literal (ref §2) acknowledges it — on the same line, directly above the
 * declaration, or directly above the rule. The audit lists it but does not fail. A literal
 * inside a var() fallback is allowed.
 *
 * Exit 1 on any error (CI), 0 otherwise. */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { root } from './lib/project-config.mjs';

const DIRS = ['src/blocks', 'src/components', 'src/lsg'];
const OSUI = join(root, 'review', 'vendor', 'outsystems-ui', 'outsystems-ui.css');
const THEME = join(root, 'dist', 'theme.css');

const COLOR = /#[0-9a-fA-F]{3,8}\b|\b(?:rgb|rgba|hsl|hsla)\([^)]*\)/g;
const NAMED = /(?<![\w-])(?:white|black|red|blue|green|gray|grey|yellow|orange|purple|pink|navy|silver)(?![\w-])/g;
const LENGTH = /(?<![\w.#-])-?\d*\.?\d+(?:px|rem|em)\b/g;
const DURATION = /(?<![\w.-])\d*\.?\d+m?s\b/g;
const ACK = /FND-\d{3}|ref §\s?\d/g;

/* Which properties a literal is an error on, and which token family can answer it. */
const RULES = [
  { prop: /^z-index$/, kind: 'Raw z-index', family: /^--layer-/ },
  { prop: /^font-size$/, kind: 'Raw font size', family: /^--font-size-/ },
  { prop: /^font-weight$/, kind: 'Raw font-weight', family: /^--font-/ },
  { prop: /radius$/, kind: 'Raw radius', family: /^--border-radius-/ },
  { prop: /shadow$/, kind: 'Raw shadow', family: /^--shadow-/ },
  { prop: /^(?:padding|margin|gap|row-gap|column-gap|inset|top|right|bottom|left)(?:-|$)/, kind: 'Raw spacing', family: /^--space-/ },
];
const COLOR_FAMILY = /^--(?:color|background-color|text-color|border-color)-/;
const BORDER_WIDTH = { prop: /^(?:border|outline)(?:-[a-z]+)*-width$|^(?:border|outline)(?:-(?:top|right|bottom|left|block|inline)(?:-start|-end)?)?$/, family: /^--border-size-/ };

function norm(v) {
  v = v.trim().toLowerCase().replace(/\s+/g, ' ');
  const hex = v.match(/^#([0-9a-f]{3})$/);
  if (hex) v = '#' + hex[1].split('').map((c) => c + c).join('');
  return v;
}

/* Global custom properties the theme can see — the framework's :root/html/body, then the
 * theme's, which win — inverted to value -> names. */
function tokenValues() {
  const byName = new Map();
  const add = (css) => {
    const clean = css.replace(/\/\*[\s\S]*?\*\//g, '');
    for (const m of clean.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const sels = m[1].split(',').map((s) => s.trim());
      if (!sels.every((s) => /^(?::root|html|body)$/.test(s))) continue;
      for (const d of m[2].matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) byName.set(d[1], norm(d[2]));
    }
  };
  if (existsSync(OSUI)) add(readFileSync(OSUI, 'utf8'));
  if (existsSync(THEME)) add(readFileSync(THEME, 'utf8'));
  const byValue = new Map();
  for (const [name, v] of byName) {
    if (!byValue.has(v)) byValue.set(v, new Set());
    byValue.get(v).add(name);
  }
  return byValue;
}

/* Keep only the first argument of every var(...), so fallbacks are not audited. */
function dropFallbacks(value) {
  let out = '';
  for (let i = 0; i < value.length; i++) {
    if (!value.startsWith('var(', i)) { out += value[i]; continue; }
    let depth = 0, j = i, comma = -1;
    for (; j < value.length; j++) {
      if (value[j] === '(') depth++;
      else if (value[j] === ')' && --depth === 0) break;
      else if (value[j] === ',' && depth === 1 && comma < 0) comma = j;
    }
    out += comma < 0 ? value.slice(i, j + 1) : value.slice(i, comma) + ')';
    i = j;
  }
  return out;
}

function files() {
  const out = [];
  for (const d of DIRS) {
    const dir = join(root, d);
    if (!existsSync(dir)) continue;
    for (const f of readdirSync(dir)) if (f.endsWith('.css') && f !== 'index.css') out.push(join(dir, f));
  }
  return out;
}

function audit(file, tokens) {
  const src = readFileSync(file, 'utf8');
  const lineOf = (i) => src.slice(0, i).split('\n').length;

  /* Acknowledging comments, by the line they end on; comments blanked out of the code with
   * line breaks kept, so offsets and line numbers still agree. */
  const ackEndingAt = new Map();
  for (const c of src.matchAll(/\/\*[\s\S]*?\*\//g)) {
    const marks = c[0].match(ACK);
    if (marks) ackEndingAt.set(lineOf(c.index + c[0].length), marks);
  }
  const code = src.replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, ' '));

  function acknowledgement(at, line) {
    for (const l of [line, line - 1]) if (ackEndingAt.has(l)) return ackEndingAt.get(l);
    const open = code.lastIndexOf('{', at);
    const before = Math.max(code.lastIndexOf('}', open - 1), code.lastIndexOf('{', open - 1));
    const selector = before + 1 + code.slice(before + 1, open).search(/\S/);
    return ackEndingAt.get(lineOf(selector) - 1) || null;
  }

  const issues = [];
  for (const m of code.matchAll(/([\w-]+)\s*:\s*([^;{}]+);/g)) {
    const prop = m[1].toLowerCase();
    if (prop.startsWith('--')) continue;
    const at = m.index + m[0].indexOf(m[2]);
    const line = lineOf(at);
    const value = dropFallbacks(m[2]);
    const ack = acknowledgement(at, line);
    const push = (severity, kind, literal, family) => {
      const same = [...(tokens.get(norm(literal)) || [])].filter((t) => family.test(t));
      issues.push({ line, severity: ack ? 'acknowledged' : severity, kind, literal, prop, ack,
        suggestion: same.length ? 'use var(' + same.slice(0, 3).join(') or var(') + ')' : null });
    };

    for (const c of value.match(COLOR) || []) push('error', 'Hardcoded color', c, COLOR_FAMILY);
    if (/color|background|border|outline|fill|stroke|shadow/.test(prop)) {
      for (const c of value.match(NAMED) || []) push('error', 'Named color', c, COLOR_FAMILY);
    }
    const rule = RULES.find((r) => r.prop.test(prop));
    if (rule && (prop === 'z-index' || prop === 'font-weight')) {
      const v = value.trim();
      if ((prop === 'z-index' && /^-?\d+$/.test(v) && v !== '0') || (prop === 'font-weight' && /^\d{3}$/.test(v))) push('error', rule.kind, v, rule.family);
    }
    for (const len of value.match(LENGTH) || []) {
      if (/^-?0*\.?0+(?:px|rem|em)$/.test(len)) continue;
      if (rule && prop !== 'z-index' && prop !== 'font-weight') push('error', rule.kind, len, rule.family);
      else if (BORDER_WIDTH.prop.test(prop)) push('warning', 'Raw border width', len, BORDER_WIDTH.family);
      else push('warning', 'Raw length', len, /^--(?:space|size)-/);
    }
    if (/^(?:transition|animation)/.test(prop)) for (const d of value.match(DURATION) || []) push('warning', 'Raw duration', d, /^--(?:motion|transition|duration)-/);
  }
  return issues;
}

const tokens = tokenValues();
if (!tokens.size) console.warn('token-audit: no token values found — run npm run build:osui and npm run build:theme for suggestions.\n');
const list = files();
console.log('Token Audit\nScanning ' + list.length + ' CSS file(s)...\n');
let errors = 0, warnings = 0, acknowledged = 0, withIssues = 0;
for (const f of list) {
  const issues = audit(f, tokens);
  if (!issues.length) continue;
  withIssues++;
  console.log(relative(root, f).replace(/\\/g, '/'));
  for (const i of issues) {
    const mark = { error: 'x', warning: '!', acknowledged: '~' }[i.severity];
    const tail = i.severity === 'acknowledged'
      ? 'built as drawn (' + i.ack.join(', ') + ')'
      : i.suggestion || (i.severity === 'error' ? 'no token holds this value: raise a design-token finding' : 'no token scale');
    console.log(`  ${mark} L${i.line}: ${i.kind} ${i.literal} in ${i.prop}, ${tail}`);
    if (i.severity === 'error') errors++;
    else if (i.severity === 'warning') warnings++;
    else acknowledged++;
  }
  console.log('');
}
console.log('=== Summary ===');
console.log('Files scanned:      ' + list.length);
console.log('Files with issues:  ' + withIssues);
console.log('Errors:             ' + errors);
console.log('Warnings:           ' + warnings);
console.log('Acknowledged:       ' + acknowledged + '  (built as drawn under a finding or the ref)');
process.exit(errors ? 1 : 0);
