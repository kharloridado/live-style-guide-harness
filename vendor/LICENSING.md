# Vendored assets — licensing policy

`vendor/` holds third-party material we build **on top of** and never edit: the OutSystems UI
submodule, the OutSystems frontend-skills pack, and — on projects that need one — a licensed
icon font.

## 1. Commit the scripts. Do not commit the licensed assets.

For a licensed vendor package (a Pro icon font is the usual case), the split is:

| Committed | Not committed |
| --- | --- |
| The conversion / generation **scripts** (e.g. a font-conversion script under `build/`) | The font binaries (`.otf`, `.woff2`, `.ttf`) |
| The CSS **templates** they consume | The vendor's metadata file containing the **vector artwork** (glyph path data) |
| Documentation of the pipeline | Any generated artifact that embeds those paths |

Everything in the right-hand column is **licensed vector artwork**, and redistributing it in a
repo — even a private one — is a licence breach. Generated outputs that carry path data live in
gitignored `dist/`, are produced on demand by the scripts, and are never checked in. A developer
who needs them supplies their own licensed copy of the vendor package and re-runs the pipeline.

Pin the vendor's major version explicitly. Assets and metadata drift between majors, and the
scripts are written against a specific one.

## 2. GitHub will refuse the file anyway — 100 MB hard limit

A vendor metadata JSON containing every glyph's path data can be **hundreds of megabytes**.
GitHub rejects any single file over **100 MB** at push time (and warns above 50 MB), so a commit
containing one is not merely a licence problem: the push fails, and the "fix" is a rewrite of
history rather than a revert.

Keep those files out of the repo from the start — gitignore the paths, do not rely on
remembering.

## 3. Never redeclare a font-family name the framework already owns

The framework's own icon widget declares an icon font family under a specific name. If your
self-hosted font declares an `@font-face` with **that same family name**, you clobber the native
widget: every icon rendered by the framework's icon component silently resolves to your font's
glyph table, and the ones that do not exist in it disappear.

Declare your icon font under its **own, distinct family name**, reference that name from your
own tokens, and leave the framework's family undeclared. Check the vendored OutSystems UI
submodule for the name it owns before you choose yours.

The related trap: an OutSystems theme module rewrites font `src:` URLs at compile time, so the
literal path you write may not be the path that is served. Verify the request in the browser's
network tab against a published module before concluding the path is wrong.

## 4. `vendor/outsystems-ui` — read it, never edit it

The OutSystems UI submodule is the source of truth for real rendered widget DOM and SCSS.
Pin it to the version your target ODC environment actually runs (record the version and the
confirmation date in `project-context.md`). Overrides are written in `tokens/` and `src/`,
never in the submodule.
