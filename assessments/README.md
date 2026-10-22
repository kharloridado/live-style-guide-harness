# Assessments

One folder per new screen, flow or component mockup, written by `/lsg:assess` before any code:

| File | What |
| --- | --- |
| `assessment.md` | Every region's outcome (reuse, reuse + variant, coming, new from OutSystems UI, new custom, screen-only), every style value against the token reference, the layout, the build plan, the screen assembly, questions for the designer |
| `regions.json` | The numbered regions with their position in the frame and their outcome |
| `figma.png` | The frame as assessed |

`assessment.html`, the annotated page, is generated from these by the plugin's `annotate.mjs` and
published as an Artifact; it is not committed.

An assessment is a plan, not a spec: each item it proposes is built later by `/lsg:design-loop`
from its own frozen ref.
