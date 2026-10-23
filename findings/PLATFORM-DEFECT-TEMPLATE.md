# Platform defect report — template

For a defect in OutSystems itself, not in the design: a publish that fails in the build engine
(`OS-*` codes), a Mentor or MCP tool that cannot do what it documents, a Studio action that does
not register. Nobody on the design side can rule on these, so they never go in the findings
register or get the `finding` label. Fill this in and give it to the user to send to OutSystems.

A worked example: `style-guide/build-error-report.md` in `kharloridado/os-react-aria`
(OS-FEW-POST-50000 once a widget library's widgets are placed).

---

**Title:** <what fails, and when — "Publishing an app fails with OS-… once it …">

**Summary:** <two or three sentences: what was done, what failed with which codes, what the last
good revision had and the failing one adds, whether it reproduced on a retry, and what the
environment runs now.>

## Environment

| | |
|---|---|
| Tenant | <tenant hostname> |
| Environment | <name> (`<environment key>`) |
| App | <name> (`<application key>`), <asset type> |
| Dependencies involved | <name> (`<asset key>`), <asset type>, revision <n> |
| Tool and version | <ODC Studio x.y.z / Mentor over the MCP / …> |
| Failing revision | <n>, saved <UTC time> |
| Last good revision | <n>, published <UTC time>: <what it already had> |
| Attempts | <UTC times; at most one retry> |

## Steps to reproduce

1. <Start from the last good state.>
2. <The one change that makes it fail.>
3. <The action that fails: publish, load, reference.>

## Expected and actual

- **Expected:** <…>
- **Actual:** <each message, verbatim, with its code>. <What the environment runs afterwards —
  from `env_app`, not from the tool's report.>

## What changed between the good and the failing revision

<The smallest description of the difference: which widgets, bound how, on which screens.>

## Evidence

<Screenshots, log excerpts, request ids. Name each file.>

## Not known yet

<What would narrow it down (one widget type at a time, a smaller app), and what could not be
reached (the build engine's detailed log).>
