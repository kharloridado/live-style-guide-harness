#!/usr/bin/env node
/* check-state.mjs — structural guard for loop/state.json and the findings register.
 *
 * WHY THIS EXISTS. `check-stylesheets.mjs` was written because a conflict boundary fell
 * inside a CSS rule three times and silently deleted a section. This is the same story in
 * a different file, and it has now happened three times too:
 *
 *   1. A maker minted FND-033..036 at build time while another branch had already
 *      committed 033 and 034 for different findings. Ten citations shipped in six files.
 *   2. Merge c85f283 took main's state.json and re-applied the pat-top-menu-bar ITEM but
 *      not its four findings[] entries. Four findings were silently deleted and the loss
 *      shipped to main in da14ac3. It was caught by hand, days later, and only because
 *      somebody happened to read the entries back while allocating IDs.
 *   3. FND-035..038 were then filed correctly — IDs taken at filing time, not build time —
 *      and STILL collided, because cmp-table and cmp-overlays filed in parallel between
 *      the counter being read and the branch being pushed. Renumbered to 045..048.
 *
 * `state.json` is the one file every item writes and NOTHING READS. Not the build, not the
 * gate, not the checker. That is exactly why these went unnoticed: a corrupted stylesheet
 * eventually renders wrong, whereas a dropped findings entry produces no symptom at all.
 * Case 2 nearly cost a real finding — FND-047 is the same defect as issue #54 reached from
 * the opposite direction, and had it stayed lost, #54 would have been the only record and
 * would have read as a screen bug rather than a header one.
 *
 * WHAT IT CANNOT DO. It cannot stop two branches allocating the same ID in parallel; only
 * a lock or a merge queue can, and neither is worth it here. Taking IDs at filing time
 * narrows the window. This catches the collision at the merge, which is the next best
 * thing and is where all three were actually detectable.
 *
 * Usage:
 *   node build/check-state.mjs            # invariants + "nothing disappeared" vs HEAD
 *                                         # (and vs MERGE_HEAD when mid-merge)
 *   node build/check-state.mjs --no-git   # invariants only
 *
 * Runs in CI and before build:theme, alongside check:config and check:stylesheets. */
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { root } from "./lib/project-config.mjs";

const STATE = join(root, "loop", "state.json");
const REGISTER = join(root, "findings", "findings-register.md");
const useGit = !process.argv.includes("--no-git");

const problems = [];
const warnings = [];
const notes = [];

/* ── load ───────────────────────────────────────────────────────────────────── */
if (!existsSync(STATE)) {
  console.log("check:state → skipped (no loop/state.json)");
  process.exit(0);
}

let state;
try {
  state = JSON.parse(readFileSync(STATE, "utf8"));
} catch (e) {
  console.error(`\ncheck:state FAILED — loop/state.json is not valid JSON.\n\n  ✗ ${e.message}\n`);
  console.error(
    "  This is almost always a merge conflict resolved inside the file. Unlike a broken\n" +
    "  stylesheet it has no rendered symptom, so nothing downstream will tell you.\n"
  );
  process.exit(1);
}

const items = Array.isArray(state.items) ? state.items : [];
const findings = Array.isArray(state.findings) ? state.findings : [];
const itemIds = new Set(items.map((i) => i?.id).filter(Boolean));

/* ── 1. no duplicate ids ────────────────────────────────────────────────────── */
for (const [label, list, key] of [
  ["item", items, "id"],
  ["finding", findings, "id"],
]) {
  const seen = new Map();
  for (const entry of list) {
    const id = entry?.[key];
    if (!id || id === "UNALLOCATED") continue;
    seen.set(id, (seen.get(id) || 0) + 1);
  }
  for (const [id, n] of seen) {
    if (n > 1) problems.push(`duplicate ${label} id \`${id}\` appears ${n} times in loop/state.json`);
  }
}

/* ── 2. every finding points at an item that exists ─────────────────────────── */
/* THE INVARIANT c85f283 BROKE. findings[] and items[] are two arrays joined only by this
 * key, which is why "re-apply the item" and "re-apply the item's findings" are two
 * operations and why doing only the first loses data with no symptom. */
for (const f of findings) {
  const item = f?.item;
  if (!item) continue;
  if (!itemIds.has(item)) {
    problems.push(
      `finding \`${f.id ?? "(no id)"}\` has item \`${item}\`, which is not in items[] — ` +
        `either the item was dropped by a merge, or the finding was copied from another branch`
    );
  }
}

/* ── 3. ids are shaped right ────────────────────────────────────────────────── */
for (const f of findings) {
  const id = f?.id;
  if (id === undefined || id === null) {
    problems.push(`a findings[] entry has no id at all (class \`${f?.class ?? "?"}\`)`);
  } else if (id !== "UNALLOCATED" && !/^FND-\d{3}$/.test(id)) {
    problems.push(`finding id \`${id}\` is not FND-NNN and is not the literal "UNALLOCATED"`);
  }
}

/* ── 4. the register agrees, and its counter is ahead of every allocated id ─── */
if (existsSync(REGISTER)) {
  const reg = readFileSync(REGISTER, "utf8");
  const next = reg.match(/Next ID:\s*FND-(\d+)/);
  const rowIds = new Set([...reg.matchAll(/^\|\s*(FND-\d{3})\s*\|/gm)].map((m) => m[1]));

  const allocated = findings.map((f) => f?.id).filter((id) => /^FND-\d{3}$/.test(id ?? ""));

  /* WARNING, not a failure — deliberately, and this should tighten later.
   *
   * On the first run this fired on six entries: FND-017, which is `withdrawn` and IS
   * documented, just as a prose section rather than a table row; and FND-035..039, which
   * `cmp-table` and `cmp-overlays` raised in state.json and never wrote rows for. The
   * second is real drift and worth surfacing. Neither is a reason to red-light everybody
   * else's build on the day this guard lands, and a guard that arrives already failing is
   * a guard people learn to skip. Promote to fatal once the backlog is clear. */
  const DOCUMENTED_ELSEWHERE = new Set(["withdrawn", "not-reproduced"]);
  for (const f of findings) {
    const id = f?.id;
    if (!/^FND-\d{3}$/.test(id ?? "")) continue;
    if (rowIds.has(id)) continue;
    if (DOCUMENTED_ELSEWHERE.has(f?.status)) continue; // withdrawn findings get prose, not a row
    warnings.push(
      `finding \`${id}\` (${f?.item ?? "?"}, status ${f?.status ?? "?"}) is allocated in loop/state.json ` +
        `but has no row in findings/findings-register.md — the register is the durable record, ` +
        `state.json is a cache`
    );
  }

  if (!next) {
    problems.push("findings/findings-register.md has no `> Next ID: FND-NNN` line");
  } else {
    const counter = Number(next[1]);
    const highest = [...allocated, ...rowIds].reduce((max, id) => Math.max(max, Number(id.slice(4))), -1);
    if (highest >= counter) {
      problems.push(
        `the register's counter is STALE: Next ID reads FND-${String(counter).padStart(3, "0")} ` +
          `but FND-${String(highest).padStart(3, "0")} is already taken. ` +
          `The next person to file will collide — this is how FND-033/034 and FND-035..038 both happened.`
      );
    }
  }
}

/* ── 4b. item status is one of the lifecycle values ─────────────────────────── */
/* Free-form statuses ("built (round 3, checker PASS)", "checker-pass", ready_for_review vs
 * ready-for-review) made the index unreadable on the first two projects. Warning, not fatal,
 * so an existing project can adopt the scaffold and clean up at its own pace. */
const STATUSES = ["queued", "built", "ready-for-review", "merged", "handover", "needs-human", "needs-re-ref", "deferred", "closed"];
const ALIASES = { ready_for_review: "ready-for-review", "checker-pass": "built", "closed-unmerged": "closed", "needs-rework": "needs-human", todo: "queued" };
for (const it of items) {
  const st = it?.status;
  if (STATUSES.includes(st)) continue;
  const hint = ALIASES[st] ?? STATUSES.find((s) => String(st ?? "").startsWith(s));
  warnings.push(
    `item \`${it?.id ?? "?"}\` has status ${JSON.stringify(st)} — use one of ${STATUSES.join(" | ")}` +
      (hint ? ` (probably "${hint}")` : "")
  );
}

/* ── 4c. every probed item has a judged baseline ───────────────────────────── */
/* gate:regression only covers items with a measurements.json; a probes.json alone is a
 * regression test that never runs. */
const SPECS = join(root, "specs");
for (const kind of existsSync(SPECS) ? readdirSync(SPECS, { withFileTypes: true }) : []) {
  if (!kind.isDirectory()) continue;
  for (const item of readdirSync(join(SPECS, kind.name), { withFileTypes: true })) {
    if (!item.isDirectory()) continue;
    const dir = join(SPECS, kind.name, item.name);
    if (existsSync(join(dir, "probes.json")) && !existsSync(join(dir, "measurements.json"))) {
      warnings.push(
        `specs/${kind.name}/${item.name} has probes.json but no measurements.json, so gate:regression ` +
          `never checks it — have the checker judge it and commit the baseline`
      );
    }
  }
}

/* ── 4d. every handover is in the embed map ─────────────────────────────────── */
/* An unmapped handover never gets its code embedded, and goes stale when its source changes. */
const HANDOVER = join(root, "handover");
const MAP = join(HANDOVER, "handover-map.json");
if (existsSync(MAP)) {
  let mapped = {};
  try { mapped = JSON.parse(readFileSync(MAP, "utf8")); } catch { problems.push("handover/handover-map.json is not valid JSON"); }
  const NOT_HANDOVERS = new Set(["README.md", "MENTOR-STUDIO-PROMPT.md"]);
  for (const f of readdirSync(HANDOVER)) {
    if (!f.endsWith(".md") || NOT_HANDOVERS.has(f) || f in mapped) continue;
    warnings.push(
      `handover/${f} has no entry in handover/handover-map.json — add its source files, or \`"${f}": []\` ` +
        `if it carries no code, then run \`npm run embed:handover\``
    );
  }
}

/* ── 5. nothing disappeared since HEAD (and since MERGE_HEAD, mid-merge) ────── */
/* This is the check that would have caught c85f283 AT THE MERGE rather than days later. */
/* IDENTITY, NOT ID — and this distinction is the whole point.
 *
 * The four entries c85f283 deleted were `id: "UNALLOCATED"`, because IDs are taken at
 * FILING time, not build time. A guard keyed on FND-NNN would sail straight past the very
 * incident this check exists for. So an entry is identified by its id when it has one and
 * by item+class when it does not, which is stable across a merge and across allocation —
 * renumbering FND-035 to FND-045 keeps `pat-top-menu-bar::top-menu / no-device-frame`
 * intact, so a legitimate renumber does not read as a deletion.
 *
 * Counting is not enough either: 32 was a perfectly plausible number for the file that had
 * just lost four entries. */
function keyOf(f) {
  const id = f?.id;
  if (/^FND-\d{3}$/.test(id ?? "")) return `id:${id}`;
  const item = f?.item ?? "?";
  const cls = f?.class ?? f?.type ?? "?";
  if (cls === "?" && !f?.summary) return null; // nothing stable to track
  return `unallocated:${item}::${cls}::${String(f?.summary ?? "").slice(0, 60)}`;
}

function snapshotAt(ref) {
  try {
    const raw = execFileSync("git", ["show", `${ref}:loop/state.json`], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      maxBuffer: 64 * 1024 * 1024,
    });
    const prev = JSON.parse(raw);
    const fs = new Set();
    for (const f of prev.findings ?? []) {
      const k = keyOf(f);
      if (k) fs.add(k);
    }
    return { findings: fs, items: new Set((prev.items ?? []).map((i) => i?.id).filter(Boolean)) };
  } catch {
    return null;
  }
}

if (useGit) {
  const nowFindings = new Set();
  for (const f of findings) {
    const k = keyOf(f);
    if (k) nowFindings.add(k);
  }
  /* A renumber keeps the id-key but changes it, so also index by the unallocated-shape key
   * to avoid flagging "FND-035 vanished" when it simply became FND-045. */
  const nowByContent = new Set(
    findings.map((f) => `${f?.item ?? "?"}::${f?.class ?? f?.type ?? "?"}`)
  );
  const refs = ["HEAD"];
  try {
    execFileSync("git", ["rev-parse", "--verify", "MERGE_HEAD"], {
      cwd: root,
      stdio: ["ignore", "pipe", "ignore"],
    });
    refs.push("MERGE_HEAD");
    notes.push("mid-merge: both parents checked");
  } catch {
    /* not mid-merge */
  }

  for (const ref of refs) {
    const before = snapshotAt(ref);
    if (!before) continue;

    const lostF = [...before.findings].filter((k) => {
      if (nowFindings.has(k)) return false;
      /* Survives a legitimate renumber: the entry is still here under a different id, so
       * long as its item+class pair is unchanged. Only a genuine deletion gets past this. */
      const m = k.match(/^unallocated:([^:]*(?:::)?[^:]*?)::([^:]*)::/);
      if (m && nowByContent.has(`${m[1]}::${m[2]}`)) return false;
      return true;
    });
    const lostI = [...before.items].filter((id) => !itemIds.has(id));

    if (lostF.length) {
      problems.push(
        `${lostF.length} finding(s) present in ${ref} are GONE from the working copy:\n      ` +
          lostF.join("\n      ") +
          `\n    Findings are never deleted — an allocated one keeps its id, and an UNALLOCATED one ` +
          `is still a finding somebody raised. If this is a merge, you took one side's file and did ` +
          `not re-apply the other side's findings[] entries.`
      );
    }
    if (lostI.length) {
      problems.push(`item(s) present in ${ref} are GONE from the working copy: ${lostI.join(", ")}`);
    }
  }
}

/* ── 6. is our counter behind origin/main's? — catch the CAUSE, not the symptom ─ */
/* All three collisions were a correct-looking counter read from a tree that had moved on.
 * A duplicate check catches it after two branches have both filed; this catches it while
 * you still have a chance to allocate from the right number. Suggested by the session that
 * caused collision #2 and then very nearly caused #4 the same way. */
if (useGit && existsSync(REGISTER)) {
  const localNext = readFileSync(REGISTER, "utf8").match(/Next ID:\s*FND-(\d+)/);
  try {
    const remote = execFileSync("git", ["show", "origin/main:findings/findings-register.md"], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      maxBuffer: 16 * 1024 * 1024,
    });
    const remoteNext = remote.match(/Next ID:\s*FND-(\d+)/);
    if (localNext && remoteNext && Number(localNext[1]) < Number(remoteNext[1])) {
      problems.push(
        `the counter is BEHIND origin/main: this branch reads Next ID FND-${localNext[1]} but ` +
          `origin/main reads FND-${remoteNext[1]}. Any id you allocate from here is already taken. ` +
          `This is the cause of all three collisions in this repo — re-read the counter from ` +
          `origin/main and renumber before pushing.`
      );
    }
  } catch {
    notes.push("origin/main not fetched — counter-drift check skipped");
  }
}

/* ── report ─────────────────────────────────────────────────────────────────── */
if (warnings.length) {
  console.warn(`\ncheck:state — ${warnings.length} warning(s), not fatal:\n`);
  for (const w of warnings) console.warn(`  ! ${w}`);
  console.warn("");
}

if (problems.length) {
  console.error("\ncheck:state FAILED — loop/state.json or the findings register is inconsistent.\n");
  for (const p of problems) console.error(`  ✗ ${p}`);
  console.error(
    "\n  state.json is the one file every item writes and nothing else reads, so a defect\n" +
    "  here has NO rendered symptom and no other gate will catch it. Three ID collisions\n" +
    "  and one silent deletion of four findings reached main before this check existed.\n\n" +
    "  If you are resolving a merge: take one side, then re-apply the other side's\n" +
    "  items[] entry AND every findings[] entry whose `item` points at it. They are two\n" +
    "  arrays joined by one key, so doing only the first loses data quietly.\n"
  );
  process.exit(1);
}

const suffix = notes.length ? ` · ${notes.join(" · ")}` : "";
console.log(
  `check:state → ok (${items.length} item(s), ${findings.length} finding(s), ` +
    `no duplicates, no orphans, counter ahead${suffix})`
);
