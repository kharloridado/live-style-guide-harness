# Findings Register — `<<CUSTOMER>>` / `<<PROJECT>>`
> Next ID: FND-001
>
> Local mirror of design-conformance findings. Live tracker = GitHub Issues labeled `finding`.
> The implementation always matches the approved design; rows here track conflicts awaiting a design/brand decision.

Increment **Next ID** every time you add a row. IDs are never reused, never renumbered, and never deleted —
a withdrawn or not-reproduced finding keeps its row and its ID, and the disposition records why. The
register is the audit trail of everything that was raised, not only of what is still open.

## Column schema

| Column | What goes in it |
|---|---|
| **ID** | `FND-NNN`, taken from the Next ID counter above. |
| **Type** | `a11y/contrast`, `a11y/brand`, `brand/token`, `design-token`, `consistency` — or a slash-combination of them. |
| **Sev** | `blocker` / `high` / `medium` / `low`. This drives the gate (below). |
| **Location** | Where it appears: the design node id and/or the code path. Specific enough that someone else can go and look at it. |
| **Observed** | What the design actually does — the measured, quoted fact, with its measurement (the computed contrast ratio, the two conflicting values, the exact hex). Not an opinion. |
| **Rule** | The rule it conflicts with: the WCAG success criterion, the brand rule, or the token rule. |
| **Recommendation** | What we propose, **with the measured result of the proposal**, plus a note of what was actually built (which is always: faithfully, as designed). Every value you recommend must have been recomputed first — see the warning in `DESIGNER-DECISION-TEMPLATE.md`. |
| **Disposition** | One value from the vocabulary below. |
| **Issue** | Link to the GitHub bug, or `n/a` when the gate kept it register-only. |

## Disposition vocabulary

Use exactly these values. Anything else and the register stops being greppable.

| Disposition | Meaning |
|---|---|
| `filed` | Raised and opened as a GitHub bug; awaiting triage. The landing state for any gated finding. |
| `resolved` | A human (designer or brand owner) ruled on it and the ruling needed **no code change** — the faithful build stands, or the cleanup lives in the design file. |
| `resolved (code changed)` | A human ruled on it and the ruling **changed the code**. The row records the new spec and where it was applied. |
| `withdrawn` | We raised it in error: the rule we cited was not actually a rule on this project (an unconfirmed convention, a misread spec). Ours to own, not the designer's. |
| `closed (not reproduced)` | It survived initial suspicion but failed the adversarial challenge — audited against real rendered usage, the problem does not materialise. Register-only; any bug opened for it gets closed. |
| `open (awaiting designer)` | Presented to the designer with measured options; no ruling yet. The only disposition that legitimately blocks a deliverable. |
| `open (register-only, low)` | Real, but below the gate. Logged, not ticketed, not chased; batched into the next design-hygiene pass. |

## The gate

`findings.gate` in `project.config.json` (default **`high+`**) decides what becomes a GitHub bug: only
**high** and **blocker** findings open issues and notify. **Medium** and **low** findings stay here in the
register.

That is deliberate, and it is what keeps the issue tracker from drowning. A real design library will generate
dozens of low-severity token-naming and consistency observations; if every one becomes an issue, the
two findings that genuinely block a release get lost among them. The register keeps them all; the gate
keeps most of them out of the tracker.

Raise the gate to `medium+` only if the customer has explicitly asked for medium findings to be triaged.

## Before you add a row

Check the finding does not already exist — here, and in the repo's `finding` issues. Re-filing an existing finding under a
new ID is the most common way this file goes wrong.

Check it against `knownFalsePositiveClasses` in `project.config.json`, and against any convention marked
`assumed` or `TBD`. **A convention that is not `confirmed` is not a rule, and nothing can be a finding
against it.**

Every finding — raised or merely suspected — must survive a refutation against **real rendered usage**
before it is filed. A colour that fails contrast as text is not a finding if nothing in the build ever
renders it as text. A finding that fails that challenge gets a row with `closed (not reproduced)`, never a
bug.

---

| ID | Type | Sev | Location | Observed | Rule | Recommendation | Disposition | Issue |
|---|---|---|---|---|---|---|---|---|

<!-- No findings logged yet. Add rows above, oldest first, and bump the Next ID counter. -->
