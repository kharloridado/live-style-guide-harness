#!/usr/bin/env node
/* build/gate/compare-measurements.mjs — the baseline diff.
 *
 * The checker's verdict is judged ONCE, at build time, against the frozen Figma ref.
 * This script answers a strictly narrower question that needs no judgment at all:
 *
 *     Build time  "Is this right?"        the checker (an agent)   once per item
 *     Every push  "Did this change?"      this script              free, forever
 *     On demand   "Is this still right?"  /revalidate              when asked
 *
 * No API key, no tokens: every committed probes.json becomes a permanent regression test.
 *
 *   node build/gate/compare-measurements.mjs --baseline a.json --current b.json
 *   node build/gate/compare-measurements.mjs --all        # every specs/<kind>/<id>/
 *
 * THE COMPARISON IS TYPED BY STABILITY, and that detail is load-bearing:
 *
 *   - Computed STRINGS (colour, font-family, font-size, radius, weight) are
 *     environment-stable and diff EXACTLY. A regression here fails the build.
 *     The highest-value catch — a webfont silently falling back to a system stack —
 *     is a font-family string diff, and that is perfectly stable.
 *
 *   - rect / ink GEOMETRY depends on font rasterisation and is compared with a
 *     tolerance and reported as INFORMATIONAL, so sub-pixel noise never fails a PR.
 *
 * There is deliberately NO --update flag. A baseline is a judged artifact; refreshing
 * one without re-judging would launder an unreviewed change into the record. If a
 * token change is intentional, re-judge the item with /lsg:revalidate.
 *
 * Exit codes:
 *   0  no regressions (informational geometry drift is allowed)
 *   1  at least one regression
 *   2  usage fault
 */
import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { allItems, specDir } from '../lib/specs.mjs';

const ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));

const EXIT_OK = 0;
const EXIT_REGRESSION = 1;
const EXIT_USAGE = 2;

/* Geometry is compared with a tolerance, in CSS px. Anything at or under this is
 * rasterisation noise, not a change. */
export const DEFAULT_TOLERANCE = 1.5;

function parseArgs(argv) {
  const out = { baseline: null, current: null, all: false, tolerance: DEFAULT_TOLERANCE, json: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === '--baseline') out.baseline = next();
    else if (a === '--current') out.current = next();
    else if (a === '--all') out.all = true;
    else if (a === '--tolerance') out.tolerance = Number(next());
    else if (a === '--json') out.json = next();
    else if (a === '--help' || a === '-h') out.help = true;
    else if (a.startsWith('--')) out.unknown = a;
  }
  return out;
}

function die(msg) {
  console.error('compare-measurements: ' + msg);
  process.exit(EXIT_USAGE);
}

function readJson(path, label) {
  try {
    return JSON.parse(readFileSync(resolve(path), 'utf8'));
  } catch (e) {
    die('could not read ' + label + ' ' + path + ': ' + e.message);
  }
}

/* Index a report's probes as viewport::probe-name -> probe. */
function indexProbes(report) {
  const map = new Map();
  for (const v of report.viewports || []) {
    for (const p of v.probes || []) {
      map.set(v.name + '::' + p.name, { probe: p, viewport: v });
    }
  }
  return map;
}

export function compare(baseline, current, tolerance = DEFAULT_TOLERANCE) {
  const findings = [];
  const push = (severity, key, detail) => findings.push({ severity, key, ...detail });

  const baseIdx = indexProbes(baseline);
  const currIdx = indexProbes(current);

  /* A viewport that could not be measured this time is a regression regardless of
   * what any individual number says — nothing below it is trustworthy. */
  for (const v of current.viewports || []) {
    if (v.status !== 'measured') {
      push('regression', v.name, {
        kind: 'viewport',
        message: 'viewport is "' + v.status + '" in the current run' + (v.reason ? ': ' + v.reason : ''),
      });
    }
  }

  for (const [key, { probe: base }] of baseIdx) {
    const hit = currIdx.get(key);
    if (!hit) {
      push('regression', key, { kind: 'missing', message: 'probe present in the baseline is absent from the current run' });
      continue;
    }
    const curr = hit.probe;

    if (base.status === 'measured' && curr.status !== 'measured') {
      push('regression', key, {
        kind: 'unmeasured',
        message: 'was measured in the baseline, unmeasured now' + (curr.reason ? ': ' + curr.reason : ''),
      });
      continue;
    }
    if (base.status !== 'measured') continue; // nothing to compare against

    /* --- stable: computed strings, exact --- */
    if (base.values) {
      for (const [prop, want] of Object.entries(base.values)) {
        const got = curr.values ? curr.values[prop] : undefined;
        if (got === undefined) {
          push('regression', key, { kind: 'props', property: prop, baseline: want, current: '(absent)', message: 'property no longer probed' });
        } else if (String(got) !== String(want)) {
          push('regression', key, { kind: 'props', property: prop, baseline: want, current: got, message: 'computed value changed' });
        }
      }
    }

    /* --- stable: js escape hatch, exact --- */
    if (base.kind === 'js') {
      const want = JSON.stringify(base.value);
      const got = JSON.stringify(curr.value);
      if (want !== got) {
        push('regression', key, { kind: 'js', property: base.expression, baseline: want, current: got, message: 'expression result changed' });
      }
    }

    /* --- unstable: geometry, tolerance, informational --- */
    const geomPairs = [];
    if (base.rect && curr.rect) {
      for (const dim of ['width', 'height', 'x', 'y']) geomPairs.push(['rect.' + dim, base.rect[dim], curr.rect[dim]]);
    }
    if (base.ink && curr.ink) {
      for (const dim of ['width', 'height']) geomPairs.push(['ink.' + dim, base.ink[dim], curr.ink[dim]]);
      /* font-size is a computed string upstream, but ink carries it as a number;
       * it is stable, so treat a change as a real regression. */
      if (base.ink.fontSize !== curr.ink.fontSize) {
        push('regression', key, { kind: 'ink', property: 'ink.fontSize', baseline: base.ink.fontSize, current: curr.ink.fontSize, message: 'font-size changed' });
      }
      if (base.ink.fontFamily !== curr.ink.fontFamily) {
        push('regression', key, { kind: 'ink', property: 'ink.fontFamily', baseline: base.ink.fontFamily, current: curr.ink.fontFamily, message: 'font stack changed — a webfont may have silently fallen back' });
      }
    }
    for (const [prop, want, got] of geomPairs) {
      if (typeof want !== 'number' || typeof got !== 'number') continue;
      const delta = Math.abs(got - want);
      if (delta > tolerance) {
        push('informational', key, { kind: 'geometry', property: prop, baseline: want, current: got, delta: Math.round(delta * 100) / 100, message: 'geometry moved more than the ' + tolerance + 'px tolerance' });
      }
    }
  }

  for (const [key] of currIdx) {
    if (!baseIdx.has(key)) {
      push('informational', key, { kind: 'new', message: 'probe is new since the baseline (the suite grew)' });
    }
  }

  return findings;
}

function report(label, findings) {
  const regressions = findings.filter((f) => f.severity === 'regression');
  const info = findings.filter((f) => f.severity === 'informational');

  console.log('\n  ' + label);
  if (!findings.length) {
    console.log('    no change');
    return regressions.length;
  }
  for (const f of regressions) {
    const detail = f.property
      ? '      ' + f.property + ': ' + f.baseline + '  ->  ' + f.current
      : '      ' + f.message;
    console.log('    REGRESSION  ' + f.key);
    console.log(detail);
    if (f.property) console.log('      (' + f.message + ')');
  }
  for (const f of info) {
    const detail = f.property ? f.property + ': ' + f.baseline + ' -> ' + f.current + ' (Δ' + f.delta + 'px)' : f.message;
    console.log('    info        ' + f.key + '  ' + detail);
  }
  return regressions.length;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('*/')[0]);
    process.exit(EXIT_OK);
  }
  if (args.unknown) die('unknown option ' + args.unknown);

  const results = [];
  let totalRegressions = 0;

  if (args.all) {
    const items = allItems().filter((id) =>
      existsSync(join(ROOT, specDir(id), 'probes.json')) &&
      existsSync(join(ROOT, specDir(id), 'measurements.json'))
    );

    if (!items.length) {
      console.log('compare-measurements: no item has both probes.json and measurements.json yet — nothing to regress against.');
      process.exit(EXIT_OK);
    }

    console.log('compare-measurements: re-measuring ' + items.length + ' item(s) against their committed baselines.');

    for (const item of items) {
      const probes = join(ROOT, specDir(item), 'probes.json');
      const baselinePath = join(ROOT, specDir(item), 'measurements.json');
      const currentPath = join(tmpdir(), 'gate-current-' + item + '.json');

      const run = spawnSync(
        process.execPath,
        [join(ROOT, 'build', 'gate', 'measure-fidelity.mjs'), '--probes', probes, '--out', currentPath],
        { cwd: ROOT, encoding: 'utf8' }
      );

      if (run.status === 4 || run.status === 2) {
        /* A harness fault is not a regression verdict — say so loudly and fail,
         * because a run that could not measure has proved nothing either way. */
        console.log('\n  ' + item);
        console.log('    HARNESS FAULT  measure-fidelity exited ' + run.status);
        console.log((run.stdout || '').split('\n').slice(-12).join('\n'));
        console.log((run.stderr || '').trim());
        totalRegressions += 1;
        results.push({ item, harnessFault: run.status });
        continue;
      }

      const baseline = readJson(baselinePath, 'baseline');
      const current = readJson(currentPath, 'current');
      const findings = compare(baseline, current, args.tolerance);
      totalRegressions += report(item, findings);
      results.push({ item, findings });
    }
  } else {
    if (!args.baseline || !args.current) die('need --baseline <file> and --current <file>, or --all');
    const baseline = readJson(args.baseline, 'baseline');
    const current = readJson(args.current, 'current');
    const findings = compare(baseline, current, args.tolerance);
    totalRegressions += report(args.baseline + '  vs  ' + args.current, findings);
    results.push({ baseline: args.baseline, current: args.current, findings });
  }

  if (args.json) {
    mkdirSync(dirname(resolve(args.json)), { recursive: true });
    writeFileSync(resolve(args.json), JSON.stringify({ tolerance: args.tolerance, results }, null, 2) + '\n');
  }

  console.log(
    '\n  ' + (totalRegressions ? totalRegressions + ' regression(s)' : 'no regressions') +
    '; exit ' + (totalRegressions ? EXIT_REGRESSION : EXIT_OK) + '\n'
  );
  process.exit(totalRegressions ? EXIT_REGRESSION : EXIT_OK);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
