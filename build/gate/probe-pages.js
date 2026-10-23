/* probe-pages.js — checks every page of a published OutSystems app (a Live Style Guide, say) from
 * one page of it, by loading each route in a hidden same-origin iframe and reading its DOM.
 * Navigating 44 routes one at a time costs a browser round trip each; this costs one.
 *
 * Paste it into the browser console (or run it with a browser tool's JavaScript call) on any page
 * of the app, then:
 *
 *   await probePages(["Button", "Checkbox", "Table"], { sections: ["Example", "Usage", "Accessibility", "API", "Styling"] })
 *
 * It returns only the pages with problems, so an empty `failing` list means every page passed:
 *   { checked: 3, failing: [{ key, title, slots, problems: ["sections: Usage|Example|…"] }] }
 *
 * Per page it checks: exactly one h1; the h2s it expects, in order; a table-of-contents link for
 * every h2; table roles (a read-only table is role="table", not the Table widget's role="grid");
 * that a tables' rows rendered; the active navigation link (aria-current="page"); and, when asked,
 * that slots are present. Every selector is an option, defaults below.
 *
 * It waits for `waitFor` (default: a table row) rather than a fixed delay, because aggregates
 * resolve after first paint and an early read sees empty lists. It does not scroll: a hidden or
 * background frame runs no requestAnimationFrame, so a smooth scroll never moves there. Check
 * scroll targets by the focused element or an instant scrollIntoView, never by a scroll position. */

async function probePages(keys, options = {}) {
  const o = {
    path: (key) => `${location.pathname.split("/").slice(0, 2).join("/")}/${key}`,
    sections: [],              // expected h2 texts, in order; extra h2s are allowed between them
    toc: "[aria-label='On this page'] a, .toc a",
    slot: null,                // e.g. ".rad-slot" — the page must have at least one
    table: "table, [role='grid'], [role='table']",
    waitFor: "tbody tr, [role='row']",
    timeout: 8000,
    settle: 300,
    ...options,
  };
  const text = (e) => e.textContent.trim().replace(/\s+/g, " ");
  const until = async (doc, selector) => {
    const end = Date.now() + o.timeout;
    while (Date.now() < end) {
      if (!selector || doc.querySelector(selector)) return true;
      await new Promise((r) => setTimeout(r, 100));
    }
    return false;
  };

  const results = [];
  for (const key of keys) {
    const frame = document.createElement("iframe");
    frame.style.cssText = "position:absolute;width:1400px;height:900px;left:-9999px;top:0";
    frame.setAttribute("aria-hidden", "true");
    frame.src = o.path(key);
    document.body.appendChild(frame);
    await new Promise((r) => (frame.onload = r));
    const d = frame.contentDocument;
    const problems = [];
    if (!(await until(d, o.waitFor))) problems.push(`timed out waiting for ${o.waitFor}`);
    await new Promise((r) => setTimeout(r, o.settle));

    const h1 = [...d.querySelectorAll('h1, [role="heading"][aria-level="1"]')].map(text);
    const h2 = [...d.querySelectorAll('h2, [role="heading"][aria-level="2"]')].map(text);
    const toc = [...d.querySelectorAll(o.toc)].map(text);
    if (h1.length !== 1) problems.push(`h1 x${h1.length}`);
    const expected = h2.filter((t) => o.sections.includes(t));
    if (o.sections.length && expected.join("|") !== o.sections.join("|")) problems.push(`sections: ${h2.join("|")}`);
    if (toc.length) for (const t of h2) if (!toc.includes(t)) problems.push(`no TOC link for ${t}`);
    if (o.slot && !d.querySelector(o.slot)) problems.push("no slots");
    if (!d.querySelector('[aria-current="page"]')) problems.push("no active navigation link");
    for (const t of d.querySelectorAll(o.table)) {
      const role = t.getAttribute("role");
      const interactive = t.querySelector("input,select,textarea,button,a[href],[contenteditable]");
      if (role === "grid" && !interactive) problems.push("read-only table has role=grid");
      if (!t.querySelector("tbody tr, [role='row'] + [role='row']")) problems.push("table with no rows");
    }
    results.push({ key, title: h1[0], slots: o.slot ? d.querySelectorAll(o.slot).length : undefined, problems });
    frame.remove();
  }
  return { checked: results.length, failing: results.filter((r) => r.problems.length) };
}
