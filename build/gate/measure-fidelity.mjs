#!/usr/bin/env node
/* build/gate/measure-fidelity.mjs — the rendered-fidelity gate.
 *
 * MEASURES the computed result of an item's specimen page in a real, headless browser.
 * It NEVER reads the frozen Figma ref, so it cannot call drift: it reports numbers
 * and an exit code, and the CHECKER compares them to the ref. Keeping mechanism and
 * judgment apart is what stops the gate from grading itself.
 *
 * Run it from the PROJECT ROOT. Repo pages are served from a virtual origin — no port.
 *
 *   node build/gate/measure-fidelity.mjs \
 *     --probes     specs/components/<item-id>/probes.json \
 *     --out        specs/components/<item-id>/measurements.json \
 *     --screenshot review/<item-id>/rendered.png
 *
 * With no --url it (re)builds review/<item-id>/specimen.html from the item's specimen.html and
 * measures that. It refuses a dist/theme.css older than its sources (exit 4).
 *
 * Exit codes — the checker reads these BEFORE it reads any number:
 *   0  every probe measured            -> compare to the ref: PASS or DRIFT
 *   3  something could not be measured -> VISUAL: unverified, never PASS
 *   4  no usable browser, or the page never loaded -> VISUAL: unverified, never PASS
 *   2  usage fault (bad args, unreadable probe file) -> also never PASS
 *
 * Any non-zero exit is a HARNESS fault, not a design verdict.
 *
 * Browser: playwright-core against an INSTALLED Chrome/Edge — no 140 MB download.
 * Override with GATE_BROWSER_PATH=/path/to/chrome.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { projectConfig } from '../lib/project-config.mjs';
import { serveRepo, urlFor } from '../lib/virtual-origin.mjs';
import { itemFromPath } from '../lib/specs.mjs';
import { writeSpecimenPage, SpecimenError } from '../review/specimen-page.mjs';

const ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));

const EXIT_OK = 0;
const EXIT_USAGE = 2;
const EXIT_UNMEASURED = 3;
const EXIT_NO_BROWSER = 4;

/* Requests of these types silently poison every number on the page when they fail:
 * the cascade falls back and each computed value still reads as a plausible number
 * describing a page nobody will ever see. A 404 here invalidates the whole viewport. */
const CRITICAL_RESOURCES = new Set(['stylesheet', 'font', 'script']);

/* One exemption: a webfont under the theme's ODC Resource path (`/<odcThemeModule>/x.woff2`).
 * ODC rewrites that src at compile time, so it cannot resolve here. It is recorded with
 * critical:false instead of invalidating the viewport; every other font stays critical.
 * Serving the faces from vendor/fonts/ (build/lib/virtual-origin.mjs) avoids the fallback. */
const THEME_RESOURCE_PREFIX = '/' + projectConfig().odcThemeModule + '/';

function isCritical(resourceType, url) {
  if (!CRITICAL_RESOURCES.has(resourceType)) return false;
  if (resourceType !== 'font') return true;
  try {
    return !new URL(url).pathname.startsWith(THEME_RESOURCE_PREFIX);
  } catch {
    return true; // unparseable URL: treat as critical rather than quietly excusing it
  }
}

const CHANNELS = ['chrome', 'msedge', 'chromium'];

/* Determinism knobs. --hide-scrollbars keeps widths equal to the design's own
 * viewport; the font flags stop platform LCD hinting from moving ink bounds. */
const LAUNCH_ARGS = [
  '--force-color-profile=srgb',
  '--disable-lcd-text',
  '--hide-scrollbars',
  '--font-render-hinting=none',
];

function parseArgs(argv) {
  const out = { probes: null, out: null, screenshot: null, url: null, timeout: 15000 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === '--probes') out.probes = next();
    else if (a === '--out') out.out = next();
    else if (a === '--screenshot') out.screenshot = next();
    else if (a === '--url') out.url = next();
    else if (a === '--timeout') out.timeout = Number(next());
    else if (a === '--help' || a === '-h') out.help = true;
    else if (a.startsWith('--')) out.unknown = a;
  }
  return out;
}

function die(code, msg) {
  console.error('measure-fidelity: ' + msg);
  process.exit(code);
}

async function launchBrowser() {
  const attempts = [];
  if (process.env.GATE_BROWSER_PATH) {
    try {
      const b = await chromium.launch({
        executablePath: process.env.GATE_BROWSER_PATH,
        args: LAUNCH_ARGS,
      });
      return { browser: b, channel: 'GATE_BROWSER_PATH (' + process.env.GATE_BROWSER_PATH + ')' };
    } catch (e) {
      attempts.push('GATE_BROWSER_PATH: ' + e.message.split('\n')[0]);
    }
  }
  for (const channel of CHANNELS) {
    try {
      const b = await chromium.launch({ channel, args: LAUNCH_ARGS });
      return { browser: b, channel };
    } catch (e) {
      attempts.push(channel + ': ' + e.message.split('\n')[0]);
    }
  }
  return { browser: null, attempts };
}

/* Runs INSIDE the page. Returns one result per probe; never throws. */
function probePage(probes) {
  const round = (n) => Math.round(n * 100) / 100;

  function decodeContent(raw) {
    const t = String(raw).trim().replace(/^["']|["']$/g, '');
    // CSS escapes an icon codepoint as "\f105"
    return t.replace(/\\([0-9a-fA-F]{1,6})\s?/g, (_, h) => String.fromCodePoint(parseInt(h, 16)));
  }

  /* Design tools inset a glyph inside its em box (icon-font ink is typically ~62.5%
   * of the em), so font-size alone proves nothing about what the eye actually sees.
   * Paint the codepoint and take its alpha bounding box. */
  function measureInk(el, pseudo) {
    const cs = getComputedStyle(el, pseudo || undefined);
    let text;
    if (pseudo) {
      const c = cs.content;
      if (!c || c === 'none' || c === 'normal') return { error: 'no generated content on ' + pseudo };
      text = decodeContent(c);
    } else {
      text = (el.textContent || '').trim();
    }
    if (!text) return { error: 'element has no glyph text to measure' };

    const fontSize = parseFloat(cs.fontSize);
    if (!isFinite(fontSize) || fontSize <= 0) return { error: 'unusable font-size ' + cs.fontSize };

    const box = Math.ceil(fontSize * 3) + 8;
    const cv = document.createElement('canvas');
    cv.width = box;
    cv.height = box;
    const ctx = cv.getContext('2d', { willReadFrequently: true });
    ctx.clearRect(0, 0, box, box);
    ctx.font = cs.fontStyle + ' ' + cs.fontWeight + ' ' + fontSize + 'px ' + cs.fontFamily;
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = '#000';
    ctx.fillText(text, box * 0.25, box * 0.75);

    const d = ctx.getImageData(0, 0, box, box).data;
    let minX = box;
    let minY = box;
    let maxX = -1;
    let maxY = -1;
    for (let y = 0; y < box; y++) {
      for (let x = 0; x < box; x++) {
        if (d[(y * box + x) * 4 + 3] > 10) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }
    if (maxX < 0) return { error: 'glyph painted no ink (font not loaded, or a blank glyph)' };
    const width = maxX - minX + 1;
    const height = maxY - minY + 1;
    return {
      width,
      height,
      fontSize,
      ratio: round(Math.max(width, height) / fontSize),
      fontFamily: cs.fontFamily,
    };
  }

  const out = [];
  for (const p of probes) {
    const r = { name: p.name, status: 'measured' };
    try {
      if (p.js) {
        r.kind = 'js';
        r.expression = p.js;
        r.value = new Function('return (' + p.js + ')')();
        out.push(r);
        continue;
      }

      r.selector = p.selector;
      if (!p.selector) {
        r.status = 'unmeasured';
        r.reason = 'probe declares neither selector nor js';
        out.push(r);
        continue;
      }

      const nodes = document.querySelectorAll(p.selector);
      const idx = p.index || 0;
      const el = nodes[idx];
      if (!el) {
        r.status = 'unmeasured';
        r.reason = nodes.length
          ? 'selector matched ' + nodes.length + ' element(s); index ' + idx + ' is out of range'
          : 'no element matched ' + p.selector;
        out.push(r);
        continue;
      }
      r.matchCount = nodes.length;
      if (p.pseudo) r.pseudo = p.pseudo;

      if (p.props) {
        r.kind = 'props';
        const cs = getComputedStyle(el, p.pseudo || undefined);
        r.values = {};
        for (const prop of p.props) {
          const v = cs.getPropertyValue(prop);
          r.values[prop] = v;
          if (v === '' || v === null) {
            r.status = 'unmeasured';
            r.reason = 'computed ' + prop + ' was empty — is it a real CSS property?';
          }
        }
      } else if (p.rect) {
        r.kind = 'rect';
        const b = el.getBoundingClientRect();
        r.rect = { x: round(b.x), y: round(b.y), width: round(b.width), height: round(b.height) };
        if (b.width === 0 && b.height === 0) {
          r.status = 'unmeasured';
          r.reason = 'element has a zero-size box (display:none, or never laid out)';
        }
      } else if (p.ink) {
        r.kind = 'ink';
        const ink = measureInk(el, p.pseudo);
        if (ink.error) {
          r.status = 'unmeasured';
          r.reason = ink.error;
        } else {
          r.ink = ink;
        }
      } else {
        r.status = 'unmeasured';
        r.reason = 'probe declares no props / rect / ink / js';
      }
    } catch (e) {
      r.status = 'unmeasured';
      r.reason = String((e && e.message) || e);
    }
    out.push(r);
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    console.log(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('*/')[0]);
    process.exit(EXIT_OK);
  }
  if (args.unknown) die(EXIT_USAGE, 'unknown option ' + args.unknown);
  if (!args.probes) die(EXIT_USAGE, 'missing --probes <file>');

  let spec;
  try {
    spec = JSON.parse(readFileSync(resolve(args.probes), 'utf8'));
  } catch (e) {
    die(EXIT_USAGE, 'could not read probe file ' + args.probes + ': ' + e.message);
  }
  const probes = spec.probes || [];
  if (!probes.length) die(EXIT_USAGE, 'probe file ' + args.probes + ' declares no probes');

  const viewports =
    spec.viewports && spec.viewports.length
      ? spec.viewports
      : [{ name: 'desktop', width: 1280, height: 900 }];

  let pagePath = args.url || spec.url;
  if (!pagePath) {
    const item = itemFromPath(resolve(args.probes));
    if (!item) die(EXIT_USAGE, 'probe file is not inside specs/<kind>/<item-id>/ and declares no url');
    try {
      pagePath = writeSpecimenPage(item);
    } catch (e) {
      if (e instanceof SpecimenError) die(EXIT_NO_BROWSER, e.message);
      throw e;
    }
  }
  const isAbsolute = /^https?:\/\//i.test(pagePath);

  /* --- browser first: no browser is exit 4 and nothing else matters --- */
  const launched = await launchBrowser();
  if (!launched.browser) {
    console.error('measure-fidelity: no usable browser.');
    console.error('  Tried, in order:');
    for (const a of launched.attempts) console.error('    - ' + a);
    console.error('  Fix: install Chrome or Edge, set GATE_BROWSER_PATH, or `npm i -D playwright`.');
    process.exit(EXIT_NO_BROWSER);
  }
  const browser = launched.browser;
  const channel = launched.channel;

  /* Repo-relative pages are served from a virtual origin inside the browser context: no
   * port is bound, so there is nothing to collide with. */
  const baseUrl = isAbsolute ? pagePath : urlFor(pagePath);

  const pwVersion = JSON.parse(
    readFileSync(join(ROOT, 'node_modules', 'playwright-core', 'package.json'), 'utf8')
  ).version;

  const report = {
    schema: 'measure-fidelity/1',
    generatedBy: 'build/gate/measure-fidelity.mjs',
    generatedAt: new Date().toISOString(),
    playwright: pwVersion,
    browser: { channel, version: browser.version() },
    url: baseUrl,
    probesFile: args.probes,
    viewports: [],
  };

  let sawUnmeasured = false;
  let sawUnloaded = false;

  try {
    for (const vp of viewports) {
      const vpReport = {
        name: vp.name || vp.width + 'x' + vp.height,
        width: vp.width,
        height: vp.height,
        status: 'measured',
        failedRequests: [],
        probes: [],
      };

      const context = await browser.newContext({
        viewport: { width: vp.width, height: vp.height },
        deviceScaleFactor: 1,
        reducedMotion: 'reduce',
      });
      if (!isAbsolute) await serveRepo(context);
      const page = await context.newPage();

      /* Chromium reports a 404 twice: once as a response, once as an aborted
       * request. Dedupe by url so the log and the committed baseline stay clean. */
      const seenFailures = new Set();
      const noteFailure = (f) => {
        const key = f.resourceType + ' ' + f.url;
        if (seenFailures.has(key)) return;
        seenFailures.add(key);
        vpReport.failedRequests.push(f);
      };
      page.on('requestfailed', (r) => {
        noteFailure({
          url: r.url(),
          resourceType: r.resourceType(),
          reason: (r.failure() && r.failure().errorText) || 'request failed',
          critical: isCritical(r.resourceType(), r.url()),
        });
      });
      page.on('response', (r) => {
        if (r.status() >= 400) {
          const type = r.request().resourceType();
          noteFailure({
            url: r.url(),
            resourceType: type,
            reason: 'HTTP ' + r.status(),
            critical: isCritical(type, r.url()),
          });
        }
      });

      let loaded = true;
      try {
        await page.goto(baseUrl, { waitUntil: 'load', timeout: args.timeout });
      } catch (e) {
        loaded = false;
        vpReport.status = 'unloaded';
        vpReport.reason = 'page never loaded: ' + e.message.split('\n')[0];
        sawUnloaded = true;
      }

      if (loaded) {
        /* WAIT FOR WEBFONTS, or every text measurement is a coin toss.
         *
         * `waitUntil: 'load'` covers stylesheets but NOT the font files a stylesheet asks
         * for: those are fetched lazily, when text first needs them, and they land after
         * `load` has already fired. Measure before they arrive and the probe records the
         * FALLBACK face — a real number, describing a frame the user never sees, that
         * changes run to run with the network. A flaky gate is worse than a red one,
         * because the first green re-run teaches everyone to re-run.
         *
         * document.fonts.ready settles once every pending face has loaded or failed. It
         * resolves either way, so a font that legitimately cannot load (a self-hosted ODC
         * path, which never resolves in this harness) does not hang the run — it just
         * stops racing us. Bounded, because a hung CDN must not become a hung gate.
         *
         * Every declared face is requested first. Otherwise a face loads only if some text on
         * the page happens to use it, and a probe that sets that weight itself measures the
         * fallback on a page with no bold copy and Roboto on a page with some. */
        try {
          await page.evaluate(
            (ms) => {
              if (!document.fonts || !document.fonts.ready) return undefined;
              document.fonts.forEach((f) => { if (f.status === 'unloaded') f.load().catch(() => {}); });
              return Promise.race([
                document.fonts.ready.then(() => undefined),
                new Promise((r) => setTimeout(r, ms)),
              ]);
            },
            args.timeout,
          );
        } catch { /* no FontFaceSet, or it rejected: measure what is there */ }

        if (spec.waitFor) {
          try {
            await page.waitForSelector(spec.waitFor, { timeout: args.timeout, state: 'attached' });
          } catch {
            vpReport.status = 'unmeasured';
            vpReport.reason = 'waitFor selector ' + spec.waitFor + ' never appeared';
            sawUnmeasured = true;
          }
        }

        const critical = vpReport.failedRequests.filter((f) => f.critical);
        if (critical.length && vpReport.status === 'measured') {
          /* A missing stylesheet does not throw. Every number below it would be a
           * plausible-looking measurement of a page nobody will ever see. */
          vpReport.status = 'invalidated';
          vpReport.reason =
            critical.length +
            ' critical request(s) failed (stylesheet/font/script) — the cascade is ' +
            'incomplete, so no number from this viewport is trustworthy';
          sawUnmeasured = true;
        }

        if (vpReport.status !== 'unmeasured') {
          try {
            vpReport.probes = await page.evaluate(probePage, probes);
          } catch (e) {
            vpReport.status = 'unmeasured';
            vpReport.reason = 'probe evaluation failed: ' + e.message.split('\n')[0];
            sawUnmeasured = true;
          }
        }

        if (vpReport.status === 'invalidated') {
          /* Keep the numbers for diagnosis, but they do not count as measured. */
          for (const p of vpReport.probes) {
            p.status = 'unmeasured';
            p.reason = 'viewport invalidated by a failed stylesheet/font/script request';
          }
        }

        if (args.screenshot) {
          const multi = viewports.length > 1;
          const shotPath = multi
            ? args.screenshot.replace(/(\.png)?$/i, '.' + vpReport.name + '.png')
            : args.screenshot;
          mkdirSync(dirname(resolve(shotPath)), { recursive: true });
          try {
            await page.screenshot({ path: resolve(shotPath), fullPage: true });
            vpReport.screenshot = shotPath;
          } catch (e) {
            vpReport.screenshotError = e.message.split('\n')[0];
          }
        }
      }

      if (vpReport.probes.some((p) => p.status === 'unmeasured')) sawUnmeasured = true;
      report.viewports.push(vpReport);
      await context.close();
    }
  } finally {
    await browser.close().catch(() => {});
  }

  const all = report.viewports.flatMap((v) => v.probes);
  report.summary = {
    viewports: report.viewports.length,
    probes: all.length,
    measured: all.filter((p) => p.status === 'measured').length,
    unmeasured: all.filter((p) => p.status === 'unmeasured').length,
    criticalFailedRequests: report.viewports.reduce(
      (n, v) => n + v.failedRequests.filter((f) => f.critical).length,
      0
    ),
  };

  const exitCode = sawUnloaded ? EXIT_NO_BROWSER : sawUnmeasured ? EXIT_UNMEASURED : EXIT_OK;
  report.exitCode = exitCode;

  if (args.out) {
    mkdirSync(dirname(resolve(args.out)), { recursive: true });
    writeFileSync(resolve(args.out), JSON.stringify(report, null, 2) + '\n');
  }

  /* Human-readable summary — the checker reads the JSON, a person reads this. */
  console.log('\n  browser   ' + channel + '  ' + browser.version());
  console.log('  url       ' + baseUrl);
  for (const v of report.viewports) {
    console.log(
      '\n  [' + v.name + '] ' + v.width + 'x' + v.height + ' — ' + v.status +
      (v.reason ? ': ' + v.reason : '')
    );
    for (const f of v.failedRequests) {
      console.log('      ' + (f.critical ? 'CRITICAL' : 'failed  ') + ' ' + f.reason + '  ' + f.url);
    }
    for (const p of v.probes) {
      if (p.status === 'measured') {
        const detail = p.values
          ? Object.entries(p.values).map(([k, val]) => k + '=' + val).join('  ')
          : p.rect
            ? 'rect ' + p.rect.width + 'x' + p.rect.height + ' @ ' + p.rect.x + ',' + p.rect.y
            : p.ink
              ? 'ink ' + p.ink.width + 'x' + p.ink.height + ' (ratio ' + p.ink.ratio + ' of ' + p.ink.fontSize + 'px)'
              : JSON.stringify(p.value);
        console.log('      ok    ' + p.name + '  ' + detail);
      } else {
        console.log('      UNMEASURED  ' + p.name + '  — ' + p.reason);
      }
    }
  }
  const s = report.summary;
  console.log(
    '\n  ' + s.measured + '/' + s.probes + ' probes measured across ' +
    s.viewports + ' viewport(s); exit ' + exitCode
  );
  if (args.out) console.log('  → ' + args.out);
  console.log('');

  process.exit(exitCode);
}

main().catch((e) => {
  console.error('measure-fidelity: unexpected failure: ' + (e && e.stack ? e.stack : e));
  process.exit(EXIT_UNMEASURED);
});
