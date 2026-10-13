# Deploy checklist — merged code into OutSystems through MCP

Run this after the code is merged to `main` (and Approved, in board mode). Each step names the
check and its **pass** condition. A deploy is done only when every step passes; record the result
table at the end in the PR or release notes. Any FAIL stops the deploy: fix it, or roll back with
`omlReset` before a merge and by re-applying the previous text after one.

Targets come from the project, never from memory: the theme module is `project.config.json` →
`odcThemeModule`; the module that holds Client Actions and Blocks, and a consumer screen to verify
on, are in `specs/foundations/platform.md` → the environment section.

Tool names below are the O11 Service Studio MCP (`servicestudio`). ODC has not been deployed
through this checklist yet: if step 0 finds no design-time MCP with the same capabilities (list,
apply, merge, publish), use the handover fallback in `CLAUDE.md` and note it here once an ODC
deploy passes.

## 0. Gate — is a working MCP active?

| Check | Pass |
|---|---|
| `createSessionToken` (the user approves a dialog in Service Studio; it can time out at 300 s — ask the user, retry once) | a token comes back |
| `listApps` | the theme module, the actions module and the consumer are listed with `isOpen: true` |
| `getValidationMessages` (filter `error`) on each target | no errors, or only errors already present before this deploy (write them down) |

**Any FAIL here → do not deploy through MCP.** Open the handover issue instead (`CLAUDE.md` →
Deploying → Fallback).

## 1. Ready to ship

| Check | Pass |
|---|---|
| `git log origin/main` | the commit being deployed is on `main` |
| `npm run build:theme` | exits 0, token audit 0 errors |
| `npm run gate:regression` | no regressions |

## 2. Read before writing

| Check | Pass |
|---|---|
| Theme: which kind (`platform.md` → environment) | **generated** by this repo → the change is the whole `build:theme:ship` output; **hand-maintained** → the change is the `src/blocks/` file appended as its own section |
| Theme: read the theme's `StyleSheet` (throw-probe) | the new section's key selector is **absent** (else it is already deployed: skip to step 6) |
| Theme, hand-maintained: look at the stylesheet's tail | it ends in ordinary CSS, not the Theme Editor `:root` block (text appended right after that block loses 2 characters) |
| Actions module: `getActionNames` / `getWebBlockNames` | the new name is free; the folder and conventions of its siblings are noted (Public, Shareable, script header kept in the JavaScript node, parameter descriptions) |

## 3. Dry run

| Check | Pass |
|---|---|
| `applyModelApiCode` with the change and a final `throw new Exception("PROBE:…")` | `validationMessages` has no **new** `type: "Error"`. On the theme only, `InvalidIconLibrary` is expected — never set `IconLibrary` to clear it |

## 4. Apply and read back

| Check | Pass |
|---|---|
| `applyModelApiCode` without the throw | `mutatedOmlPath` is non-empty, `exceptionMessage` empty, no new Error |
| Read back (throw-probe) | the theme stylesheet equals the shipped file (generated) or contains the whole appended file, first and last rule intact (hand-maintained); the action has its parameters, folder, `Public`, and a JavaScript node identical to the repo file |

## 5. Merge and publish

| Check | Pass |
|---|---|
| `omlMerge` per module | `merged: true` (never call it twice for one path) |
| `omlPublish` theme module, then actions module | `published: true`, `status: "success"` |
| Publish messages | "Outdated Consumer" = the consumers that still need step 6. "Potential Incompatible Consumer" → name it in the record and check it before closing |

## 6. Verify in a consumer — the producer's own URL proves nothing

A consumer serves the producer version it was last compiled with (`platform.md` §12).

| Check | Pass |
|---|---|
| A **new** public action or block: the user ticks it in the consumer's Manage Dependencies (the Model API cannot add a dependency) | the consumer's references list it |
| `omlRefreshReferences` on the consumer (before any apply — it drops the session pointer), then `omlPublish` | `published: true` |
| Fetch the consumer's own `/<Consumer>/css/<ThemeModule>.<Theme>.css` | contains the new selector |
| Fetch the consumer screen's compiled `…<Screen>.mvc.js` | calls `<ActionsModule>.controller$<Action>`, not a local copy |
| Load the screen in a browser | the specimen's probe values match (colour, fill, state classes) and the behaviour works (events blocked/fired as specified) |
| Remove scaffolding from the demo (local copies of the action, CSS pasted into a screen stylesheet) and republish | the consumer still passes the two checks above. A non-empty screen or block stylesheet edit does not always publish — confirm in the served CSS |

## 7. Record

| Check | Pass |
|---|---|
| `CHANGELOG.md` | says where the code lives in OutSystems and what each consumer must do (refresh, tick, republish) |
| The item's usage spec → "Delivered as" | names the module, folder and element |
| This table, filled in | pasted into the PR or release notes |

```
| Step | Result | Evidence |
|---|---|---|
| 0 Gate | PASS | token ok; listApps: <modules>; pre-existing errors: <none> |
| 1 Ready | PASS | <sha>; build 0 errors; gate no regressions |
| 2 Read | PASS | selector absent; tail ok; name free |
| 3 Dry run | PASS | no new errors (InvalidIconLibrary expected) |
| 4 Apply | PASS | read-back identical |
| 5 Publish | PASS | <modules> published; incompatible consumers: <none> |
| 6 Consumer | PASS | <consumer>: CSS has selector; mvc.js calls <Module>.controller$<Action>; probes match |
| 7 Record | PASS | CHANGELOG, spec |
```
