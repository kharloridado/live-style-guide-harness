#!/usr/bin/env node
/* build/sync-check.mjs — which specs might need updating. Reports; never edits; always exits 0.
 *
 *   1. OutSystems UI: the pinned submodule commit against the latest upstream release tag
 *      (skipped with `framework: "none"`).
 *   2. The token reference: is specs/tokens/token-reference.md current with dist/theme.css?
 *   3. Usage specs: any --token a spec names that the token set no longer has.
 *   4. Frozen refs: pulled from a Figma file other than project.config.json figma.fileKey.
 *   5. Code newer than its usage spec: an item's CSS/JS committed after its specs/<kind>/<id>.md.
 *
 *   npm run sync */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { execSync, spawnSync } from 'node:child_process';
import { projectConfig, root, usesOutSystemsUI } from './lib/project-config.mjs';
import { allItems, kindOf, specDir } from './lib/specs.mjs';

const cfg = projectConfig();
const read = (p) => readFileSync(join(root, p), 'utf8');
const exists = (p) => existsSync(join(root, p));
const git = (cmd) => { try { return execSync('git ' + cmd, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { return ''; } };
const flags = [];
const say = (section, lines) => {
  console.log(`\n## ${section}`);
  if (!lines.length) console.log('  ok');
  for (const l of lines) { console.log('  ! ' + l); flags.push(section); }
};

/* 1 */
if (!usesOutSystemsUI()) {
  console.log('\n## OutSystems UI pin\n  skipped (framework is none)');
} else {
  const lines = [];
  const pin = (git('ls-tree HEAD vendor/outsystems-ui').split(/\s+/)[2] || '').slice(0, 12);
  const pinnedTag = exists('vendor/outsystems-ui/.git') ? git('-C vendor/outsystems-ui describe --tags --abbrev=0') : '';
  const url = (read('.gitmodules').match(/url\s*=\s*(\S+)/) || [])[1];
  const remote = url ? git(`ls-remote --tags --refs ${url}`) : '';
  const tags = remote.split('\n').map((l) => l.split('refs/tags/')[1]).filter((t) => t && /^v?\d+\.\d+\.\d+$/.test(t));
  const latest = tags.sort((a, b) => a.replace(/^v/, '').localeCompare(b.replace(/^v/, ''), 'en', { numeric: true })).pop();
  console.log(`\nOutSystems UI pinned at ${pin || 'unknown'}${pinnedTag ? ' (' + pinnedTag + ')' : ''}; latest upstream release ${latest || 'unknown (offline?)'}`);
  if (latest && pinnedTag && pinnedTag !== latest) lines.push(`upstream shipped ${latest} — pin it only after the target ODC environment runs it, then re-run build:osui, gate:regression and this check`);
  say('OutSystems UI pin', lines);
}

/* 2 */
let tokenNames = new Set();
{
  const lines = [];
  const run = spawnSync(process.execPath, [join(root, 'build/token-reference.mjs'), '--check'], { cwd: root, encoding: 'utf8' });
  if (run.status !== 0) lines.push((run.stdout || run.stderr).trim());
  if (exists('specs/tokens/token-reference.md')) tokenNames = new Set(read('specs/tokens/token-reference.md').match(/`(--[\w-]+)`/g).map((s) => s.slice(1, -1)));
  /* Component-scoped custom properties a block declares are real too. */
  for (const d of ['src/blocks', 'src/components']) {
    if (!exists(d)) continue;
    for (const f of readdirSync(join(root, d))) {
      for (const m of read(`${d}/${f}`).matchAll(/(--[\w-]+)\s*:/g)) tokenNames.add(m[1]);
    }
  }
  say('Token reference', lines);
}

/* 3 */
{
  const lines = [];
  const specFiles = [];
  for (const kind of ['components', 'patterns', 'tokens']) {
    const dir = join(root, 'specs', kind);
    if (existsSync(dir)) for (const f of readdirSync(dir)) if (f.endsWith('.md') && f !== 'token-reference.md') specFiles.push(`specs/${kind}/${f}`);
  }
  if (exists('specs/foundations')) for (const f of readdirSync(join(root, 'specs/foundations'))) if (f.endsWith('.md')) specFiles.push(`specs/foundations/${f}`);
  for (const f of specFiles) {
    const text = read(f);
    /* A name the spec also writes on a class (`.x--inline`) is a BEM modifier, not a token. */
    const isModifier = (t) => new RegExp('\\w' + t.replace(/[-]/g, '\\-') + '(?![\\w-])').test(text);
    const unknown = [...new Set(text.match(/(?<![\w-])--[a-z][\w-]*[a-z0-9](?![\w*-])/g) || [])]
      .filter((t) => t.length > 4 && !tokenNames.has(t) && !isModifier(t) && !t.startsWith('--osui-') && !t.startsWith('--gate') && !t.startsWith('--' + cfg.classPrefix + 'gate'));
    if (unknown.length) lines.push(`${f} names ${unknown.slice(0, 6).join(', ')}${unknown.length > 6 ? ` and ${unknown.length - 6} more` : ''} — not in the token set (component-scoped, or gone?)`);
  }
  say('Usage specs name real tokens', lines);
}

/* 4 */
{
  const lines = [];
  const byKey = new Map();
  for (const id of allItems()) {
    if (!exists(`${specDir(id)}/ref.md`)) continue;
    const key = (read(`${specDir(id)}/ref.md`).match(/file[^\n]*?`([A-Za-z0-9]{22})`/i) || [])[1] || 'not recorded';
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(id);
  }
  for (const [key, ids] of byKey) {
    if (key === cfg.figma?.fileKey) continue;
    lines.push(`${ids.length} ref(s) pulled from ${key === 'not recorded' ? 'an unrecorded file' : '`' + key + '`'}, not the current library \`${cfg.figma?.fileKey}\`: ${ids.join(', ')}`);
  }
  say('Frozen refs against the current Figma library', lines);
}

/* 5 */
{
  const lines = [];
  for (const id of allItems()) {
    const spec = `specs/${kindOf(id)}/${id}.md`;
    const specimen = exists(`${specDir(id)}/specimen.html`) ? read(`${specDir(id)}/specimen.html`) : '';
    const code = [...new Set(specimen.match(/src\/(?:blocks|components)\/[\w.-]+\.(?:css|js)/g) || [])].filter(exists);
    if (!code.length) continue;
    if (!exists(spec)) { lines.push(`${id} has code but no usage spec (${spec})`); continue; }
    const specTime = Number(git(`log -1 --format=%ct -- ${spec}`)) || Infinity;
    const newer = code.filter((p) => (Number(git(`log -1 --format=%ct -- ${p}`)) || 0) > specTime);
    if (newer.length) lines.push(`${spec} predates ${newer.join(', ')} — check it still describes the component`);
  }
  say('Usage specs against their code', lines);
}

console.log(`\n${flags.length ? flags.length + ' thing(s) to look at' : 'Nothing to update'} — this check never fails the build.\n`);
