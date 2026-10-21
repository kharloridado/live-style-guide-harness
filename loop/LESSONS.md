# Loop lessons

Lessons the build loop paid for — each cost at least one rebuild, one reversed decision, or one
correction in front of the client. Read this before building or judging an item, not after the first
bug. Platform rules (how OutSystems UI and ODC constrain the code itself) are in
`specs/foundations/platform.md`; lessons about the fidelity gate and CI are in
`build/gate/LESSONS.md`.

---

## 1. Design-source traps

### 1.1 Design variables are mode-bound: one NAME can be many values

A single design variable name resolves to **different values in different modes** — per component size,
per device/breakpoint, per theme. The variables panel shows one resolved value: the value for whichever
mode the frame you are looking at happens to be in.

Freezing that one value into a single shared token silently breaks every other mode. A body-text size
that reads as one number on the type page may be three numbers across desktop/tablet/phone. A label
token that looks shared may be pinned per component.

The discipline: **snapshot every size variant and every device frame** of a component into
`specs/<kind>/<id>/` before extracting its tokens, and extract each variable *per mode*, not once. When a
token legitimately varies by device, express that in CSS (device classes or a responsive step), not by
picking a winner.

**Why:** a responsive type ramp was extracted from a single desktop frame and shipped as flat fixed
sizes; the device axis was found later, and a finding had been filed against the design that was in
fact a misreading of it.

### 1.2 Never trust a documentation or handover claim about the design

A handover note, a design-system page or a component description that says "single size" / "one
variant" / "not responsive" is a **claim**, not evidence. Verify it against the design file's own
component-size and variant collections. Designs routinely carry more variants than their documentation
admits, and the shipped "default" is often not the variant labelled default.

**Why:** a badge was built single-size on the strength of a handover note. The design's component-size
collection carried four sizes, and the variant shipped as "default" was the largest.

### 1.3 Do not enforce a convention nobody confirmed

`project.config.json` states each convention as `confirmed` / `assumed` / `TBD`. A convention that is not
`confirmed` **is not a rule**: do not enforce it and do not raise findings against it. A plausible default
is worse than a blank, because it manufactures false positives that cost real review time and real
credibility.

**Why:** a template shipped a spacing base of "4pt" that nobody had verified. The loop flagged every value
not a multiple of four, producing a run of false-positive findings and at least one GitHub bug closed as
not-planned. Add to `knownFalsePositiveClasses` in the config whenever a class of false positive is
identified, so the checker stops re-raising it. Rulings and signed-off exceptions go in
`specs/decisions.md`.

---

## 2. Build and repository hygiene

### 2.1 Generated files must look generated, and drift must fail the build

Every file a generator emits carries a banner saying it is generated, by which script, and that edits
will be overwritten. Beyond that, a build step should **detect drift** — regenerate and compare — and
fail rather than quietly accept a hand-edited generated file.

**Why:** hand edits to generated utility files were lost on the next build, twice, and the second loss
went unnoticed for several commits.

### 2.2 Licensed vendor assets stay in gitignored `dist/` — never commit vector artwork

Icon fonts and similar vendor assets are **licensed, not redistributable**. Any build output that embeds
the licensed vector artwork (glyph path data, font binaries, export manifests carrying paths) stays in a
gitignored `dist/`, generated on demand from the vendored, licence-covered source, and never committed.

Two corollaries:

- Watch the host's **per-file size limit** (GitHub rejects files over 100MB and warns well below). Font
  and icon manifests get large fast.
- **Never redeclare a font family the framework's own icon widget owns.** The framework declares its icon
  family under a well-known legacy name; a self-hosted font redeclaring that name clobbers the native
  icon widget everywhere. Declare your font under its own current family name and leave the legacy name
  alone.

**Why:** an early icon build committed the full path-bearing manifests, and a separate build redeclared
the legacy icon family name and broke every native icon in the application.

### 2.3 Concurrent agents on one working tree race each other

A scheduled routine and an interactive session writing the same checkout interleave: one stages files
the other is mid-edit on, or commits a tree holding the other's half-finished work. Give every
**scheduled or background routine its own git worktree and its own branch**, so it can never touch the
tree a human is working in.

Regardless: **re-check `git status` immediately before every commit**, and stage explicit paths rather
than `git add -A`. What was in the tree when you planned the commit is not necessarily what is in it now.

**Why:** a scheduled routine committed an interactive session's unfinished work into an unrelated
branch, and the untangling cost more than the routine saved.

### 2.4 A setup script that swallows an API error is worse than one that crashes

A script that logs a failed API call to stderr, carries on and prints "Done" ships the broken state to
every project that runs it, and nothing fails until someone relies on what it claimed to set up. Every
setup or migration script exits non-zero on the first failed call.

**Why:** a board-setup script (since removed with board mode) tried to delete and recreate GitHub's
built-in `Status` field, got `Only custom fields can be deleted`, and reported success. Every board it
"set up" kept the default lanes and could not express the review gate.

---

## Where a new lesson goes

A lesson that a script can enforce becomes a check in `build/` (with the incident in its error
message or the PR), not a paragraph here. Platform behaviour goes in `specs/foundations/platform.md`;
gate behaviour in `build/gate/LESSONS.md`. This file keeps only what no check can catch.
