/* css-structure.mjs — balanced braces and terminated comments, by hand.
 *
 * Used on dist/theme.css (validate-theme.mjs) and on every hand-edited stylesheet
 * (check-stylesheets.mjs).
 *
 * Not a CSS parser, on purpose: an unclosed rule is not a syntax error. The parser reads what
 * follows as more declarations of that rule and drops them silently, so the page renders
 * without them and nothing reports it. The usual cause is a merge conflict resolved across a
 * rule boundary.
 */

/** @returns {string|null} a human-readable problem, or null when the file is sound. */
export function checkStructure(s, label = "stylesheet") {
  let depth = 0;
  let line = 1;
  let openedAt = 0;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === "\n") { line++; continue; }
    if (s[i] === "/" && s[i + 1] === "*") {
      const end = s.indexOf("*/", i + 2);
      if (end === -1) return `unterminated comment opened at ${label}:${line}`;
      line += s.slice(i, end).split("\n").length - 1;
      i = end + 1;
      continue;
    }
    if (s[i] === "{") {
      if (depth === 0) openedAt = line;
      depth++;
    } else if (s[i] === "}" && --depth < 0) {
      return `unexpected "}" at ${label}:${line}`;
    }
  }
  if (depth > 0) {
    return `${depth} unclosed "{" in ${label} — a block is never closed. ` +
           `The last top-level block opens at ${label}:${openedAt}. ` +
           `Everything after an unclosed rule is silently dropped at parse time, so the ` +
           `page renders without it and nothing errors.`;
  }
  return null;
}
