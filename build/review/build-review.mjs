#!/usr/bin/env node
/* build/review/build-review.mjs — one self-contained review page per build, published as an Artifact.
 *
 *   npm run review -- cmp-button          → review/cmp-button.html   (one deliverable)
 *   npm run review                        → review/index.html        (the whole library)
 *   npm run review -- --all               → both
 *   add --no-measure to reuse the committed baselines instead of re-measuring
 *
 * Each page shows the frozen Figma frame beside the live specimen (the same page the gate
 * measures, with every stylesheet, font and script inlined), the gate's measurements against the
 * judged baseline, the item's findings, and the code to paste into ODC. */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync, execSync } from 'node:child_process';
import { projectConfig, root, usesOutSystemsUI } from '../lib/project-config.mjs';
import { allItems, kindOf, specDir } from '../lib/specs.mjs';
import { repoPathFor } from '../lib/virtual-origin.mjs';
import { compare } from '../gate/compare-measurements.mjs';
import { OSUI_CSS, THEME_CSS, assertInputsFresh, blockFiles, pageBody, readSpecimen, SpecimenError } from './specimen-page.mjs';

const read = (p) => readFileSync(join(root, p), 'utf8');
const readJson = (p) => JSON.parse(read(p));
const exists = (p) => existsSync(join(root, p));

function parseArgs(argv) {
  const out = { ids: [], all: false, measure: true };
  for (const a of argv) {
    if (a === '--all') out.all = true;
    else if (a === '--no-measure') out.measure = false;
    else if (a.startsWith('--')) throw new Error('unknown option ' + a);
    else out.ids.push(a);
  }
  return out;
}

/* ---------- shared assets: exactly what the specimen page links, inlined ---------- */

function inlineFonts(css) {
  return css.replace(/url\(\s*["']?(\/[^"')]+\.(ttf|woff2?|otf))["']?\s*\)/g, (m, url, ext) => {
    const p = repoPathFor(url).replace(/^\//, '');
    if (!exists(p)) return m;
    const type = { ttf: 'font/ttf', woff: 'font/woff', woff2: 'font/woff2', otf: 'font/otf' }[ext];
    return `url("data:${type};base64,${readFileSync(join(root, p)).toString('base64')}")`;
  });
}

function sharedAssets(ids) {
  const styles = [
    ...(usesOutSystemsUI() ? [{ href: OSUI_CSS, css: read(OSUI_CSS) }] : []),
    { href: THEME_CSS, css: inlineFonts(read(THEME_CSS)) },
    ...blockFiles().map((f) => ({ href: `src/blocks/${f}`, css: read(`src/blocks/${f}`) })),
    { href: 'build/review/specimen.css', css: read('build/review/specimen.css') },
  ];
  const scripts = {};
  for (const id of ids) {
    if (!exists(`${specDir(id)}/specimen.html`)) continue;
    for (const m of pageBody(id).matchAll(/<script data-src="([^"]+)"><\/script>/g)) scripts[m[1]] = read(m[1]);
  }
  return { styles, scripts, stateGate: read('build/review/state-gate.js') };
}

/* ---------- brand: the review chrome wears the project's theme ---------- */

/* Custom properties declared on :root / html / body, in cascade order across the given sheets,
 * plus the font-family set on html or body. */
function globalDeclarations(sheets) {
  const vars = {};
  let family = null;
  for (const css of sheets) {
    const text = css.replace(/\/\*[\s\S]*?\*\//g, '');
    for (const m of text.matchAll(/(?<=^|})\s*([^{}@]+)\{([^{}]*)\}/g)) {
      const selectors = m[1].split(',').map((x) => x.trim());
      if (!selectors.every((x) => /^(:root|html|body)$/.test(x))) continue;
      for (const d of m[2].matchAll(/(?<![\w-])(--[\w-]+|font-family)\s*:\s*([^;]+)/g)) {
        if (d[1] === 'font-family') family = d[2].trim();
        else vars[d[1]] = d[2].trim();
      }
    }
  }
  return { vars, family };
}

function resolveVar(value, vars, depth = 0) {
  if (value == null || depth > 10) return null;
  return value.replace(/var\(\s*(--[\w-]+)\s*(?:,\s*([^()]*(?:\([^()]*\))?[^()]*))?\)/g, (_, name, fallback) =>
    resolveVar(vars[name], vars, depth + 1) ?? resolveVar(fallback?.trim(), vars, depth + 1) ?? '');
}

/* Primary colour, neutrals and body face from the OutSystems UI base, then the project theme, so
 * an unthemed project reviews in OutSystems UI's own colours. Status colours stay the chrome's:
 * they must stay legible on any brand. */
function brandCss(styles) {
  const { vars, family } = globalDeclarations(styles.map((x) => x.css));
  const v = (name) => resolveVar(vars[name], vars) || null;
  const primary = v('--color-primary');
  if (!primary) return '';
  const light = {
    '--accent': primary,
    '--accent-soft': `color-mix(in srgb, ${primary} 12%, white)`,
    '--ink': v('--color-neutral-10'),
    '--muted': v('--color-neutral-8'),
    '--line': v('--color-neutral-4'),
    '--ground': v('--color-neutral-1'),
    '--surface-2': v('--color-neutral-2'),
    '--stage': v('--color-neutral-3'),
  };
  const dark = {
    '--accent': `color-mix(in srgb, ${primary} 55%, white)`,
    '--accent-soft': `color-mix(in srgb, ${primary} 30%, #161d27)`,
  };
  const block = (o) => Object.entries(o).filter(([, x]) => x).map(([k, x]) => `${k}: ${x};`).join(' ');
  const face = resolveVar(family, vars);
  const faces = styles.map((x) => x.css.match(/@font-face\s*\{[^}]*\}/g) || []).flat().join('\n');
  return [
    faces,
    face ? `:root { --sans: ${face}, system-ui, -apple-system, "Segoe UI", sans-serif; --cond: var(--sans); }` : '',
    `:root { ${block(light)} }`,
    `@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { ${block(dark)} } }`,
    `:root[data-theme="dark"] { ${block(dark)} }`,
  ].filter(Boolean).join('\n');
}

/* ---------- measurements ---------- */

function describe(p) {
  if (!p) return null;
  if (p.status !== 'measured') return 'unmeasured: ' + (p.reason || '');
  if (p.values) return Object.entries(p.values).map(([k, v]) => `${k}: ${v}`).join('; ');
  if (p.rect) return `${p.rect.width} × ${p.rect.height} @ ${p.rect.x}, ${p.rect.y}`;
  if (p.ink) return `ink ${p.ink.width} × ${p.ink.height}, ratio ${p.ink.ratio} of ${p.ink.fontSize}px`;
  return JSON.stringify(p.value);
}

function measure(id) {
  const probes = `${specDir(id)}/probes.json`;
  const out = `review/${id}/measurements.json`;
  const run = spawnSync(process.execPath, [join(root, 'build/gate/measure-fidelity.mjs'), '--probes', probes, '--out', out], { cwd: root, encoding: 'utf8' });
  if (run.status === 2 || run.status === 4 || !exists(out)) {
    console.error(`review: ${id} could not be measured (exit ${run.status})\n${(run.stderr || '').trim()}`);
    return null;
  }
  return readJson(out);
}

function gateFor(id, doMeasure) {
  const probes = `${specDir(id)}/probes.json`;
  if (!exists(probes)) return null;
  const basePath = `${specDir(id)}/measurements.json`;
  const baseline = exists(basePath) ? readJson(basePath) : null;
  const current = doMeasure ? measure(id) : baseline;
  const report = current || baseline;
  if (!report) return null;

  const judged = new Map();
  if (baseline && current) {
    for (const f of compare(baseline, current)) {
      if (f.kind === 'viewport') continue;
      /* Where a specimen sits on its page is layout, not design: only size counts. */
      if (f.property === 'rect.x' || f.property === 'rect.y') continue;
      const prev = judged.get(f.key);
      if (f.severity === 'regression') judged.set(f.key, f.kind === 'missing' ? 'missing' : f.kind === 'unmeasured' ? 'unmeasured' : 'changed');
      else if (!prev) judged.set(f.key, f.kind === 'new' ? 'new' : 'moved');
    }
  }
  const index = (r) => new Map((r?.viewports || []).flatMap((v) => (v.probes || []).map((p) => [v.name + '::' + p.name, { vp: v.name, p }])));
  const cur = index(current);
  const base = index(baseline);
  const keys = [...new Set([...base.keys(), ...cur.keys()])];
  const rows = keys.map((k) => {
    const c = cur.get(k);
    const b = base.get(k);
    let state = judged.get(k) || (baseline ? 'match' : 'unjudged');
    if (c && c.p.status !== 'measured' && state === 'match') state = 'unmeasured';
    return { viewport: (c || b).vp, name: (c || b).p.name, current: describe(c?.p), baseline: describe(b?.p), state };
  });
  const order = { changed: 0, missing: 1, unmeasured: 2, moved: 3, new: 4, unjudged: 5, match: 6 };
  rows.sort((a, b) => order[a.state] - order[b.state]);
  const all = (report.viewports || []).flatMap((v) => v.probes || []);
  return {
    baseline: !!baseline,
    probes: all.length,
    measured: all.filter((p) => p.status === 'measured').length,
    unmeasured: all.filter((p) => p.status !== 'measured').length,
    regressions: rows.filter((r) => r.state === 'changed' || r.state === 'missing').length,
    viewports: (report.viewports || []).map((v) => ({ name: v.name, width: v.width, height: v.height })),
    rows,
  };
}

/* ---------- findings ---------- */

function registerRows() {
  const text = read('findings/findings-register.md');
  const rows = {};
  for (const line of text.split('\n')) {
    if (!/^\|\s*FND-\d+/.test(line)) continue;
    const cells = line.split(/(?<!\\)\|/).slice(1, -1).map((c) => c.trim());
    const [id, type, sev, location, observed, , , disposition, issue] = cells;
    rows[id] = { id, type, sev, location, observed, disposition, issue };
  }
  return rows;
}

const plain = (s) => String(s || '').replace(/\*\*|`|<br>/g, '').replace(/\s+/g, ' ').trim();

function findingsFor(id, state, register, repo, files) {
  const ids = new Set((state.findings || []).filter((f) => f.item === id).map((f) => f.id));
  for (const r of Object.values(register)) {
    const loc = r.location || '';
    if (loc.includes(id) || files.some((f) => loc.includes(f))) ids.add(r.id);
  }
  return [...ids].sort().map((fid) => {
    const r = register[fid] || {};
    const s = (state.findings || []).find((f) => f.id === fid) || {};
    const num = String(r.issue || s.issue || '').match(/#?(\d+)/);
    const summary = plain(s.summary || r.observed);
    return {
      id: fid,
      sev: plain(r.sev || s.sev || '').toLowerCase(),
      type: plain(r.type || s.type),
      disposition: plain(r.disposition || s.disposition),
      summary: summary.length > 420 ? summary.slice(0, 420) + '…' : summary,
      issue: num && !/n\/a/i.test(r.issue || '') ? `https://github.com/${repo}/issues/${num[1]}` : null,
    };
  });
}

/* ---------- one item ---------- */

/** The component's own name from its specimen heading ("Button — cmp-button …" → "Button"). */
function titleOf(id) {
  const own = exists(`${specDir(id)}/specimen.html`) ? readSpecimen(id) : '';
  const heading = (own.match(/<h[23][^>]*>([\s\S]*?)<\/h[23]>/) || [])[1];
  return heading ? heading.replace(/<[^>]+>/g, '').split(/\s(?:—|&mdash;)\s/)[0].trim() : id;
}

function itemData(id, ctx) {
  const dir = specDir(id);
  const st = (ctx.state.items || []).find((i) => i.id === id) || {};
  const hasSpecimen = exists(`${dir}/specimen.html`);
  const body = hasSpecimen ? pageBody(id, { markIncludes: true }) : '';
  const own = hasSpecimen ? readSpecimen(id) : '';
  const paths = new Set();
  for (const m of String(st.artifact || '').matchAll(/(?:src|tokens)\/[\w/.-]+\.(?:css|js)/g)) paths.add(m[0]);
  for (const m of own.matchAll(/<h2[^>]*>[\s\S]*?<\/h2>/g)) for (const p of m[0].matchAll(/src\/(?:blocks|components)\/[\w.-]+\.(?:css|js)/g)) paths.add(p[0]);
  const code = [...paths].filter(exists).map((p) => ({ path: p, text: read(p) }));
  const ref = exists(`${dir}/ref.md`) ? read(`${dir}/ref.md`) : '';
  const fileKey = (ref.match(/Figma file key\s*\|\s*`([^`]+)`/) || [])[1] || ctx.cfg.figma?.fileKey;
  const node = st.node && /^\d+[-:]\d+$/.test(st.node) ? st.node : null;
  const gate = gateFor(id, ctx.measure);
  const probeSpec = exists(`${dir}/probes.json`) ? readJson(`${dir}/probes.json`) : {};
  return {
    id,
    kind: kindOf(id),
    title: titleOf(id),
    status: st.status || null,
    figma: exists(`${dir}/figma.png`) ? 'data:image/png;base64,' + readFileSync(join(root, dir, 'figma.png')).toString('base64') : null,
    figmaUrl: fileKey && node ? `https://www.figma.com/design/${fileKey}/?node-id=${node}` : null,
    viewports: (gate && gate.viewports.length ? gate.viewports : probeSpec.viewports) || [],
    body,
    code,
    ref,
    gate,
    findings: findingsFor(id, ctx.state, ctx.register, ctx.cfg.repo, code.map((c) => c.path)),
  };
}

function render(title, ids, ctx) {
  const project = {
    customer: ctx.cfg.customer,
    designSystemName: ctx.cfg.designSystemName,
    version: readJson('package.json').version,
    commit: ctx.commit,
    builtAt: new Date().toISOString().slice(0, 16).replace('T', ' ') + ' UTC',
  };
  const data = { project, shared: sharedAssets(ids), items: ids.map((id) => itemData(id, ctx)) };
  const json = JSON.stringify(data).replace(/<\//g, '<\\/').replace(/<!--/g, '<\\u0021--');
  const brand = brandCss(data.shared.styles.slice(0, 2)).replace(/<\//g, '<\\/');
  const html = read('build/review/review-template.html')
    .split('__TITLE__').join(title).split('__PREFIX__').join(ctx.cfg.classPrefix)
    .split('__BRAND__').join(brand).split('__DATA__').join(json);
  return { html, data };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const cfg = projectConfig();
  try {
    assertInputsFresh();
  } catch (e) {
    if (e instanceof SpecimenError) { console.error('review: ' + e.message); process.exit(4); }
    throw e;
  }
  let commit = 'uncommitted';
  try { commit = execSync('git rev-parse --short HEAD', { cwd: root, encoding: 'utf8' }).trim(); } catch { /* not a checkout */ }
  const ctx = { cfg, commit, measure: args.measure, state: exists('loop/state.json') ? readJson('loop/state.json') : {}, register: exists('findings/findings-register.md') ? registerRows() : {} };
  const items = allItems();
  for (const id of args.ids) if (!items.includes(id)) { console.error(`review: no item ${id} under specs/`); process.exit(2); }
  mkdirSync(join(root, 'review'), { recursive: true });

  const perItem = args.all ? items : args.ids;
  for (const id of perItem) {
    const { html, data } = render(`${cfg.customer} ${titleOf(id)} Review`, [id], ctx);
    writeFileSync(join(root, 'review', `${id}.html`), html);
    const g = data.items[0].gate;
    console.log(`review → review/${id}.html  (${(html.length / 1048576).toFixed(1)} MB${g ? `; ${g.measured}/${g.probes} measured, ${g.regressions} changed` : '; no probes'})`);
  }
  if (!args.ids.length || args.all) {
    const { html } = render(`${cfg.customer} Library Review`, items, ctx);
    writeFileSync(join(root, 'review', 'index.html'), html);
    console.log(`review → review/index.html  (${(html.length / 1048576).toFixed(1)} MB, ${items.length} items)`);
  }
}

main();
