/* specimen-page.mjs — assembles review/<id>/specimen.html, the page the fidelity gate measures.
 *
 * Load order: the compiled OutSystems UI base, dist/theme.css (tokens + block overrides, the
 * ODC paste), then every src/blocks file again as its own sheet in src/blocks/index.css order,
 * then the specimen chrome. The per-file sheets repeat what theme.css already holds, in the same
 * order, so the cascade is unchanged — they exist so a probe can find `<prefix>input.css` by href and
 * audit exactly the rules one file authors.
 *
 * A specimen may place `<!-- include: cmp-checkbox -->` anywhere: that item's specimen renders
 * there, one level deep (its own includes are dropped, so two items can include each other).
 * Probes that pick `nodes[index]` count matches in document order, so position is part of the
 * probe. */
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { projectConfig, root } from '../lib/project-config.mjs';
import { specDir } from '../lib/specs.mjs';

export const OSUI_CSS = 'review/vendor/outsystems-ui/outsystems-ui.css';
export const THEME_CSS = 'dist/theme.css';

export class SpecimenError extends Error {}

function newestMtime(dir, ext) {
  let t = 0;
  if (!existsSync(dir)) return t;
  for (const f of readdirSync(dir)) if (f.endsWith(ext)) t = Math.max(t, statSync(join(dir, f)).mtimeMs);
  return t;
}

/** dist/theme.css is gitignored, so a stale copy measures a page nobody ships. Refuse it. */
export function assertInputsFresh() {
  const osui = join(root, OSUI_CSS);
  const theme = join(root, THEME_CSS);
  if (!existsSync(osui)) throw new SpecimenError(`${OSUI_CSS} is missing — run: npm run build:osui`);
  if (!existsSync(theme)) throw new SpecimenError(`${THEME_CSS} is missing — run: npm run build:theme`);
  const src = Math.max(newestMtime(join(root, 'tokens'), '.css'), newestMtime(join(root, 'src', 'blocks'), '.css'));
  if (statSync(theme).mtimeMs < src) {
    throw new SpecimenError(`${THEME_CSS} is older than tokens/ or src/blocks/ — run: npm run build:theme`);
  }
}

const INCLUDE = /^[ \t]*<!--\s*include:\s*([\w-]+)\s*-->[ \t]*\r?\n?/gm;

export function readSpecimen(id) {
  const file = join(root, specDir(id), 'specimen.html');
  if (!existsSync(file)) throw new SpecimenError(`${specDir(id)}/specimen.html does not exist`);
  return readFileSync(file, 'utf8');
}

/** Includes this item's specimen declares, in order. */
export function includesOf(id) {
  return [...readSpecimen(id).matchAll(INCLUDE)].map((m) => m[1]);
}

/** Body markup for an item's page: its specimen with each include expanded one level. */
export function pageBody(id, { markIncludes = false } = {}) {
  return readSpecimen(id)
    .replace(INCLUDE, (_, other) => {
      const body = readSpecimen(other).replace(INCLUDE, '').trimEnd();
      /* The review page's demo hides included specimens; the measured page never gets a wrapper. */
      return (markIncludes ? `<div data-review="included" data-item="${other}">\n${body}\n</div>` : body) + '\n\n';
    })
    .trimEnd();
}

/* `rel` is the prefix from the page to the repo root. `<script data-src>` names a repo file;
 * `[data-framework-baseline]` is an iframe that loads the framework base and nothing else. */
export function resolveMarkers(html, rel) {
  return html
    .replace(/<script data-src="([^"]+)"><\/script>/g, (_, p) => `<script src="${rel}${p}"></script>`)
    .replace(/<iframe([^>]*)\sdata-framework-baseline([^>]*)><\/iframe>/g, (_, a, b) => {
      const doc = `<!DOCTYPE html><html><head><link rel="stylesheet" href="${rel}${OSUI_CSS}"></head><body></body></html>`;
      return `<iframe${a}${b} srcdoc="${doc.replace(/&/g, '&amp;').replace(/"/g, '&quot;')}"></iframe>`;
    });
}

/** src/blocks/index.css @import order — the same order build:theme appends them in. */
export function blockFiles() {
  const index = readFileSync(join(root, 'src', 'blocks', 'index.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  return [...index.matchAll(/@import\s+["']\.\/([^"']+)["']/g)].map((m) => m[1]);
}

export function specimenHtml(id, rel = '../../') {
  const cfg = projectConfig();
  const blocks = blockFiles().map((f) => `<link rel="stylesheet" href="${rel}src/blocks/${f}">`).join('\n');
  return `<!DOCTYPE html>
<html lang="en" data-prefix="${cfg.classPrefix}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${id} — specimen</title>
<link rel="stylesheet" href="${rel}${OSUI_CSS}">
<link rel="stylesheet" href="${rel}${THEME_CSS}">
${blocks}
<link rel="stylesheet" href="${rel}build/review/specimen.css">
</head>
<body>

  <header class="${cfg.classPrefix}specimen__head">
    <h1>${cfg.designSystemName}</h1>
    <p>${id}</p>
  </header>

  <main class="${cfg.classPrefix}specimen__body">

${resolveMarkers(pageBody(id), rel)}

  </main>

  <script src="${rel}build/review/state-gate.js"></script>
</body>
</html>
`;
}

/** Writes review/<id>/specimen.html and returns its repo-relative path. */
export function writeSpecimenPage(id) {
  assertInputsFresh();
  const rel = `review/${id}/specimen.html`;
  mkdirSync(join(root, 'review', id), { recursive: true });
  writeFileSync(join(root, rel), specimenHtml(id));
  return rel;
}
