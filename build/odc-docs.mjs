#!/usr/bin/env node
/* odc-docs.mjs — package the design system's agent-readable Markdown for import into ODC.
 *
 * The specs/ Markdown is written to be read by agents and people outside this repo. Imported
 * into an ODC module as Resources, it is context for Mentor and for whoever uses the Live
 * Style Guide or the design system. This script builds that import:
 *
 *   dist/odc-docs/<name>.md                 every document, flattened and link-rewritten
 *   dist/odc-docs/manifest.json             version, target module, sha256 per document
 *   dist/odc-docs-<version>.zip             everything
 *   dist/odc-docs-<version>-changed.zip     only what is new or changed since the last import
 *
 * "Last import" is handover/odc-docs-imported.json, committed. `--record` writes the current
 * hashes into it; run it once the changed zip has been imported, and commit it with the
 * release. A document in the ledger but no longer produced is reported for deletion in ODC.
 *
 * Usage: node build/odc-docs.mjs [--record]
 * Exit:  0 ok · 1 error */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, posix, relative } from "node:path";
import { crc32, deflateRawSync } from "node:zlib";
import { moduleName, projectConfig, root } from "./lib/project-config.mjs";

const cfg = projectConfig();
const version = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version;
const record = process.argv.includes("--record");
const outDir = join(root, "dist", "odc-docs");
const ledgerPath = join(root, "handover", "odc-docs-imported.json");

/* Which documents ship, and the flat name each gets. ODC Resources are a flat list, so the
 * folder becomes a name prefix. Frozen Figma refs, probes and handovers stay in the repo. */
function sources() {
  const list = [];
  const add = (rel, name) => existsSync(join(root, rel)) && list.push({ rel, name });
  add("specs/README.md", "specs-readme.md");
  add("specs/decisions.md", "decisions.md");
  add("specs/tokens/token-reference.md", "token-reference.md");
  for (const dir of ["foundations", "components", "patterns"]) {
    const abs = join(root, "specs", dir);
    if (!existsSync(abs)) continue;
    for (const f of readdirSync(abs).filter((f) => f.endsWith(".md")).sort()) {
      add(`specs/${dir}/${f}`, dir === "foundations" ? `foundation-${f}` : f);
    }
  }
  return list;
}

/* Rewrite relative links. A link to a shipped document points at its flat name; anything else
 * becomes plain text naming the repo path, so nothing dangles inside ODC. */
function rewriteLinks(text, fromRel, nameBySource) {
  return text.replace(/\[([^\]]+)\]\((?!https?:|mailto:|#)([^)\s]+)\)/g, (whole, label, target) => {
    const [path, hash = ""] = target.split("#");
    const resolved = posix.normalize(posix.join(posix.dirname(fromRel), path));
    const name = nameBySource.get(resolved);
    const shown = label.replace(/^`|`$/g, "") === target ? label.replace(target, name) : label;
    if (name) return `[${shown}](${name}${hash ? `#${hash}` : ""})`;
    return label.includes(resolved) ? label : `${label} (repo: \`${resolved}\`)`;
  });
}

/* A minimal zip writer: deflated entries, no directories. */
function zip(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const { name, data } of entries) {
    const nameBuf = Buffer.from(name, "utf8");
    const packed = deflateRawSync(data);
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(packed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    locals.push(local, nameBuf, packed);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(packed.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBuf);
    offset += local.length + nameBuf.length + packed.length;
  }
  const centralSize = centrals.reduce((n, b) => n + b.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, ...centrals, end]);
}

const sha = (buf) => createHash("sha256").update(buf).digest("hex");

const docs = sources();
const nameBySource = new Map(docs.map((d) => [d.rel, d.name]));
const built = docs.map(({ rel, name }) => {
  const text = rewriteLinks(readFileSync(join(root, rel), "utf8").replace(/\r\n/g, "\n"), rel, nameBySource);
  const data = Buffer.from(text, "utf8");
  return { name, source: rel, data, sha256: sha(data), bytes: data.length };
});

const ledger = existsSync(ledgerPath) ? JSON.parse(readFileSync(ledgerPath, "utf8")) : { files: {} };
const imported = ledger.files || {};
const added = built.filter((d) => !imported[d.name]);
const changed = built.filter((d) => imported[d.name] && imported[d.name] !== d.sha256);
const current = new Set(built.map((d) => d.name));
const removed = Object.keys(imported).filter((n) => !current.has(n)).sort();

rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });
for (const d of built) writeFileSync(join(outDir, d.name), d.data);
const manifest = {
  designSystem: cfg.designSystemName,
  version,
  module: moduleName('theme'),
  files: built.map(({ name, source, sha256, bytes }) => ({ name, source, sha256, bytes })),
};
const manifestBuf = Buffer.from(JSON.stringify(manifest, null, 2) + "\n");
writeFileSync(join(outDir, "manifest.json"), manifestBuf);

const fullZip = join(root, "dist", `odc-docs-${version}.zip`);
writeFileSync(fullZip, zip([...built, { name: "manifest.json", data: manifestBuf }]));
const delta = [...added, ...changed];
const deltaZip = join(root, "dist", `odc-docs-${version}-changed.zip`);
rmSync(deltaZip, { force: true });
if (delta.length) writeFileSync(deltaZip, zip(delta));

const rel = (p) => relative(root, p).replace(/\\/g, "/");
console.log(`odc-docs → ${rel(outDir)}/ (${built.length} documents for ${moduleName('theme')})`);
console.log(`  all:     ${rel(fullZip)}`);
console.log(delta.length ? `  changed: ${rel(deltaZip)} (${delta.length})` : "  changed: none — ODC is up to date");
for (const d of added) console.log(`    + ${d.name}   new`);
for (const d of changed) console.log(`    ~ ${d.name}`);
for (const n of removed) console.log(`    - ${n}   no longer produced — delete this Resource in ODC`);

if (record) {
  mkdirSync(dirname(ledgerPath), { recursive: true });
  const files = Object.fromEntries(built.map((d) => [d.name, d.sha256]));
  const out = {
    $comment: "What ODC holds, by document hash. Written by `npm run docs:odc:record` after an import; commit it with the release.",
    version,
    recorded: new Date().toISOString().slice(0, 10),
    module: moduleName('theme'),
    files,
  };
  writeFileSync(ledgerPath, JSON.stringify(out, null, 2) + "\n");
  console.log(`  recorded ${built.length} documents as imported → ${rel(ledgerPath)}`);
}
