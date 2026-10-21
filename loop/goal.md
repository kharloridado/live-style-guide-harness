# Loop goal — <<DESIGN_SYSTEM_NAME>>

The scope contract for `/lsg:design-loop` when it works through a queue (a full
library, or a batch of components). A one-off request in a session ("build the error state for the
input") does not need this file: the request plus a frozen ref is the scope.

Figma URL and file key, class prefix and every other project value live in `project.config.json`.
Do not copy them here.

## Goal

<One sentence. e.g. "Translate the <<DESIGN_SYSTEM_NAME>> Figma library into OutSystems, tier by tier, as theme tokens + block CSS + Web Components.">

## Inventory of record

The loop builds only what is in this table. A component that is in Figma but not here is
`needs-human`, not `queued`; to add scope, someone who owns it adds a row, and
`git log loop/goal.md` records who and when.

| Signed off by | Date |
|---|---|
| <name, role — someone who can commit to the list> | <yyyy-mm-dd> |

| # | Item id | Component | Tier | Figma node | Notes |
|---|---|---|---|---|---|
| 1 | `tok-foundations` | Tokens | foundations | `<node>` | |
| 2 | `cmp-<name>` | <Component> | primitives | `<node>` | |

Order rows by dependency: foundations → primitives → composites → patterns. A row with no Figma
node and no written spec cannot be built (no ref, no build).

**Why this is required:** on the project this template came from, a component set was built end to
end and then thrown away, because no confirmed list existed and the client's real list was
different.

## Figma scope

| In scope | Out of scope |
|---|---|
| <"entire library" \| named pages / frames / node ids> | <pages deliberately excluded> |

## Run settings

| Setting | Value |
|---|---|
| Mode | `<single \| library>` — `library` builds tier by tier with the checkpoints below |
| Tiers | foundations, primitives, composites, patterns |
| Pause after foundations | yes — a wrong token cascades into every component |
| Pause after primitives | yes — lock the highest-reuse components first |
| Pause after composites | no |
| Max maker/checker rounds per item | 3 — then `needs-human` |
| Items per run | <N — the number of PRs someone will review in one sitting> |

A pause is a hard stop: the loop writes `loop/REPORT.md` and exits.

## Done when

<The stopping condition for this run, in terms someone can check — e.g. "every primitive in the
inventory has a merged PR or is needs-human with its blocker named".>

## Open decisions

1. <Anything that must be confirmed before the next tier.>
