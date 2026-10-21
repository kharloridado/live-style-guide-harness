# Designer Decision Document — template

Copy this file to `findings/designer-discussion-YYYY-MM-DD.md` when you have findings that need a design
or brand ruling. This is the artifact that actually produces sign-off. A finding on its own does not: a
bare "this fails contrast" gives the designer nothing to decide between, so it comes back as "what do you
suggest?" and a week is gone. A finding with **measured options** gets a tick in a box in the meeting.

Everything in the copied document must be true of your project — replace `<<CUSTOMER>>`,
`<<DESIGN_SYSTEM_NAME>>`, the finding IDs, and every value.

---

> ## ⚠️ Recompute every value before it goes in front of the designer
>
> **Every colour, size, or ratio you recommend must have its contrast (or its measurement) recomputed
> against the surface it will actually sit on, before this document is sent.** Do not reach for the token
> whose name sounds like the answer — "Emphasis", "Strong", "Dark" — and assume it passes. Compute it.
>
> A recommendation that also fails costs the designer's confidence in every number here. Recompute, and if a previously-circulated recommendation turns out to fail, carry the correction openly
> in the document (see the callout pattern in section A below) rather than quietly swapping it.

---

# Designer Discussion — `<<DESIGN_SYSTEM_NAME>>` / `<<CUSTOMER>>` Design-Conformance Findings
**Prepared:** YYYY-MM-DD · **For:** design / brand owner · **From:** front-end (`<name>`)

## How to read this

Every item below was **built faithfully to the design** — nothing in code was silently changed. These are
conflicts between the design as published and our accessibility, brand, or token rules, and each one needs
a design decision. Pick an option per item; we apply the code change (or keep the faithful build plus your
sign-off) accordingly.

Contrast figures are measured (WCAG 2.2): **4.5:1** = normal-text minimum, **3:1** = large text and
non-text (borders, icons, UI boundaries).

---

## A. Decisions needed now

One subsection per finding that requires a ruling. Keep each to a screen. The pattern is: where it appears,
what the problem is with its measurement, an options table where **every row carries the measured result**,
and a decision line the designer can tick.

### A1 — `<short human title, not the finding title>`  `FND-NNN` · **HIGH** · GitHub #NN
**Where:** the component, the variant, the state, and the exact tokens involved. Name the surface the
colour sits on — the ruling depends on it.
**Problem:** the failure, with the measured number and what floor it misses. State the blast radius: which
elements of the component are affected, and whether other components share the same token (if they do, say
so — one ruling then fixes several, which is a strong reason for the designer to make it).

> ⚠️ *Correction, when applicable.* If an earlier note recommended a value that turns out to fail, say so
> here, in the open, with the real number: "the previously-suggested `Outline/Emphasis` reaches only
> **2.53:1** and still fails — do not use it." Owning the correction costs less than being caught by it.

| Option | Result | Notes |
|---|---|---|
| **① `<token / value>`** | **4.55** | *Recommended.* Why: smallest change that passes, keeps the intended look. |
| ② `<token / value>` | **5.28** | Stronger definition, more margin; existing token, no new primitive needed. |
| ③ `<token / value>` | **3.07** | Closest to the current look, but only just clears the floor. |
| ④ Sign off as-is | fails | Accept the trade-off; faithful to the design, no code change. |

**Decision:** ☐ ① ☐ ② ☐ ③ ☐ ④ ___________

Rules for the options table:

- **Every row has a measured Result.** No row says "should be fine" or "probably passes".
- **Always include a "sign off as-is" row.** Accepting the trade-off is a legitimate decision, and offering
  it is what makes the document a decision aid rather than a demand. Mark its Result honestly (`fails`).
- **Mark exactly one option Recommended**, and say in one clause why. A table with no recommendation sends
  the decision back to you.
- Order the options by how close they stay to the published design, not by how much you like them.
- Where one token is shared across several components, say **"one ruling resolves both"** and list them.

### A2 — …

Repeat as needed. If you have more than about five, you have a triage problem, not a decision document —
raise the gate and batch the rest.

---

## B. Closed — for awareness only (no action needed)

Findings that were raised and then **closed without a design decision**, listed so the designer knows they
existed and knows why they went away. This section is not filler: it is the evidence that the process
refutes its own findings instead of forwarding everything.

- **`FND-NNN`** `<one-line description, with the number that made it look like a problem>` — **closed, not
  reproduced.** The audit of real rendered usage showed the failing condition never occurs in the build:
  say concretely where the value *is* used and why each of those uses is safe. *If* a future design does
  use it in the failing way, tell us — that would re-open it.

---

## C. Design-file hygiene follow-ups (code is already correct)

Findings resolved with **no code change** that nonetheless leave an inconsistency in the design file worth
tidying, so design and code stay in sync. There is no decision to make here — there is a small cleanup to
schedule, and an explicit **Ask**.

- **`FND-NNN` — `<title>`.** What diverges (a style named one thing carrying a value that means another; a
  token published twice with different values on two pages). What we did: we honoured the **value**, and
  the built code is right. **Ask:** either rename the style in the design file to match the value, or change
  the value if the name was the intent — but pick one.
- **`FND-NNN` — `<title>`.** Confirmed canonical value is `<X>`; page `<Y>` of the design file still shows
  `<Z>`. Please reconcile it in the design file.

---

## D. Already accepted (logged, closed)

For completeness — reviewed and accepted as-is, no code change and no further action:
`FND-NNN`, `FND-NNN`, `FND-NNN`. Full rationale per finding is in `findings/findings-register.md`.

---

*Full detail and measured values for every finding: `findings/findings-register.md`.
GitHub finding issues: label `finding` on `<<OWNER/REPO>>`.*
