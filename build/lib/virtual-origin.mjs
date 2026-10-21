/* build/lib/virtual-origin.mjs — serve the repo to a Playwright context without binding a port.
 *
 * Every request to ORIGIN is fulfilled from the repo root inside the browser context, so
 * pages see real http:// URL semantics (root-relative paths resolve) and no socket is opened.
 * A bound port is what made the old preview server fail with EADDRINUSE in sandboxes.
 *
 * `/<theme module>/<file>` maps to that file anywhere under vendor/fonts/: the theme authors its @font-face src as
 * an ODC Resource path, which only ODC rewrites, and dist/theme.css must stay byte-identical
 * to what is pasted into ODC. */
import { readdirSync, existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { moduleName } from './project-config.mjs';

export const ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));
export const ORIGIN = 'http://repo.gate';
export const FONT_DIR = 'vendor/fonts';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
};

export function fontPrefix() {
  return '/' + moduleName('theme') + '/';
}

/** Every file under vendor/fonts/, by name — a project keeps its self-hosted faces there. */
let fontIndex;
function fontFile(name) {
  if (!fontIndex) {
    fontIndex = new Map();
    const walk = (dir) => {
      for (const d of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
        if (d.isDirectory()) walk(dir + '/' + d.name);
        else if (!fontIndex.has(d.name)) fontIndex.set(d.name, dir + '/' + d.name);
      }
    };
    if (existsSync(join(ROOT, FONT_DIR))) walk(FONT_DIR);
  }
  return fontIndex.get(name);
}

export function repoPathFor(urlPath) {
  const prefix = fontPrefix();
  if (!urlPath.startsWith(prefix)) return urlPath;
  const rel = urlPath.slice(prefix.length);
  const found = fontFile(rel.split('/').pop());
  return '/' + (found || FONT_DIR + '/' + rel);
}

export async function serveRepo(context) {
  await context.route(ORIGIN + '/**', async (route) => {
    const urlPath = decodeURIComponent(new URL(route.request().url()).pathname);
    const filePath = normalize(join(ROOT, repoPathFor(urlPath)));
    if (!filePath.startsWith(normalize(ROOT))) return route.fulfill({ status: 403, body: 'Forbidden' });
    try {
      const body = await readFile(filePath);
      await route.fulfill({
        status: 200,
        body,
        headers: { 'Content-Type': TYPES[extname(filePath).toLowerCase()] || 'application/octet-stream' },
      });
    } catch {
      await route.fulfill({ status: 404, body: '404 Not Found' });
    }
  });
}

export function urlFor(repoRelativePath) {
  return ORIGIN + '/' + repoRelativePath.replace(/\\/g, '/').replace(/^\//, '');
}
