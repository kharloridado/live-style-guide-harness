# Findings

Design-conformance findings for this project. The rule: **build the design exactly as specified; never silently change a brand color, value, or token to satisfy accessibility.** Conflicts are logged here and (for `high+`) opened as GitHub Issues — not fixed in code until design responds or the brand owner signs off.

## What gets flagged (not fixed)
- Brand-color contrast failures (WCAG 2.2 AA)
- Colors not in the brand palette
- Hard-coded values with no matching design token
- Fixed-size targets under 24px; flow-level a11y (consistent help, redundant entry, auth)

## What still gets fixed silently
Focus rings (in the design's own colors), keyboard handlers, ARIA, semantic HTML, reduced-motion, labels — anything that doesn't change the visual design.

## Flow
1. `findings-register.md` — running table (mirror).
2. `tickets/FND-NNN.md` — one payload per routed finding.
3. GitHub Issue per `high+` finding, via `gh` from Claude Code:
   ```bash
   gh issue create --title "FND-001 [a11y/contrast] ..." --body-file findings/tickets/FND-001.md \
     --label "finding,bug,a11y,sev:high" --repo <owner/repo>
   ```
4. First-time repo setup: `.github/setup-finding-labels.sh <owner/repo>`.
5. Slack (optional): `/github subscribe <owner/repo> issues +label:finding`.

See the `outsystems-design-findings` skill for the schema and severity rubric.
