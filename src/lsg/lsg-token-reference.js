/* lsg-token-reference.js — <lsg-token-reference>, a Live Style Guide foundation page renderer.
 *
 * Lists every design token of one kind that the page's stylesheets declare on :root / html /
 * body, in declaration order, with its live computed value and a specimen. Token names are
 * discovered, not listed here, so a token added to the theme appears on the next publish.
 *
 *   <lsg-token-reference kind="color" heading="Colors" intro="…"></lsg-token-reference>
 *
 * Attributes
 *   kind     color | font-size | font-weight | space | radius | border-size | shadow  (required)
 *   heading  section heading; omitted when empty
 *   intro    one-sentence intro under the heading
 *   filter   regular expression a token name must match, e.g. "^--color-(primary|neutral)"
 *   exclude  regular expression a token name must not match
 */
(function () {
  "use strict";

  const KINDS = {
    color: { prefix: "--color-", sample: "swatch" },
    "font-size": { prefix: "--font-size-", sample: "text" },
    "font-weight": { prefix: "--font-", sample: "weight", skip: /^--font-(size|family)-/, numeric: true },
    space: { prefix: "--space-", sample: "bar" },
    radius: { prefix: "--border-radius-", sample: "radius" },
    "border-size": { prefix: "--border-size-", sample: "border" },
    shadow: { prefix: "--shadow-", sample: "shadow" },
  };

  const GLOBAL = /^(?::root|html|body)(?:\[[^\]]*\]|:[\w-]+(?:\([^)]*\))?)*$/;

  /* Token names in declaration order across every readable stylesheet. */
  function discover(prefix) {
    const names = [];
    const seen = new Set();
    const visit = (rules) => {
      for (const rule of rules) {
        if (rule.cssRules && !rule.selectorText) {
          visit(rule.cssRules);
          continue;
        }
        if (!rule.selectorText || !rule.style) continue;
        const selectors = rule.selectorText.split(",").map((s) => s.trim());
        if (!selectors.every((s) => GLOBAL.test(s))) continue;
        for (let i = 0; i < rule.style.length; i++) {
          const name = rule.style[i];
          if (name.startsWith(prefix) && !seen.has(name)) {
            seen.add(name);
            names.push(name);
          }
        }
      }
    };
    for (const sheet of document.styleSheets) {
      let rules;
      try {
        rules = sheet.cssRules;
      } catch (e) {
        continue; // cross-origin sheet: unreadable by design
      }
      if (rules) visit(rules);
    }
    return names;
  }

  function family(name, prefix) {
    return name.slice(prefix.length).split("-")[0];
  }

  const STYLE = `
    :host { display: block; font-family: inherit; color: var(--color-neutral-10, currentColor); }
    h2 { margin: 0 0 var(--space-s, 0.5rem); font-size: var(--font-size-h4, 1.25rem); }
    h3 { margin: var(--space-l, 1.5rem) 0 var(--space-s, 0.5rem); font-size: var(--font-size-base, 1rem); text-transform: capitalize; }
    p { margin: 0 0 var(--space-m, 1rem); color: var(--color-neutral-8, currentColor); }
    table { width: 100%; table-layout: fixed; border-collapse: collapse; font-size: var(--font-size-s, 0.875rem); }
    th, td { text-align: left; vertical-align: middle; padding: var(--space-s, 0.5rem); border-bottom: var(--border-size-s, 1px) solid var(--color-neutral-4, currentColor); }
    th { font-weight: var(--font-semi-bold, 600); color: var(--color-neutral-8, currentColor); }
    code { font-family: var(--font-family-code, monospace); overflow-wrap: anywhere; }
    .col-sample { width: 30%; }
    .col-token { width: 35%; }
    .col-value { width: 25%; }
    .col-copy { width: 10%; }
    .swatch { width: var(--space-xxl, 3rem); height: var(--space-xl, 2rem); border-radius: var(--border-radius-soft, 4px); border: var(--border-size-s, 1px) solid var(--color-neutral-4, currentColor); }
    .bar { height: var(--space-s, 0.5rem); background: var(--color-primary, currentColor); }
    .box { width: var(--space-xxl, 3rem); height: var(--space-xxl, 3rem); background: var(--color-neutral-0, transparent); border: var(--border-size-s, 1px) solid var(--color-neutral-6, currentColor); }
    .text { line-height: 1.2; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    button { font: inherit; cursor: pointer; padding: var(--space-xs, 0.25rem) var(--space-s, 0.5rem); border: var(--border-size-s, 1px) solid var(--color-neutral-5, currentColor); border-radius: var(--border-radius-soft, 4px); background: var(--color-neutral-0, transparent); color: inherit; }
    button:focus-visible { outline: var(--border-size-m, 2px) solid var(--color-focus-outer, currentColor); outline-offset: var(--border-size-m, 2px); }
    .empty { color: var(--color-neutral-8, currentColor); }
  `;

  class LsgTokenReference extends HTMLElement {
    static get observedAttributes() {
      return ["kind", "heading", "intro", "filter", "exclude"];
    }

    constructor() {
      super();
      this.attachShadow({ mode: "open" });
      this._onClick = this._onClick.bind(this);
    }

    connectedCallback() {
      this.shadowRoot.addEventListener("click", this._onClick);
      /* Stylesheets attached after this element still count: render once they have applied. */
      requestAnimationFrame(() => this._render());
    }

    disconnectedCallback() {
      this.shadowRoot.removeEventListener("click", this._onClick);
    }

    attributeChangedCallback() {
      if (this.isConnected) this._render();
    }

    _render() {
      const kind = KINDS[this.getAttribute("kind")];
      const heading = this.getAttribute("heading") || "";
      const intro = this.getAttribute("intro") || "";
      const root = this.shadowRoot;
      root.textContent = "";

      const style = document.createElement("style");
      style.textContent = STYLE;
      root.appendChild(style);
      if (heading) root.appendChild(el("h2", heading));
      if (intro) root.appendChild(el("p", intro));
      if (!kind) {
        root.appendChild(el("p", `Unknown kind "${this.getAttribute("kind")}".`, "empty"));
        return;
      }

      const filter = toRegExp(this.getAttribute("filter"));
      const exclude = toRegExp(this.getAttribute("exclude"));
      const computed = getComputedStyle(document.documentElement);
      const tokens = discover(kind.prefix)
        .filter((n) => !(kind.skip && kind.skip.test(n)))
        .filter((n) => !filter || filter.test(n))
        .filter((n) => !exclude || !exclude.test(n))
        .map((name) => ({ name, value: computed.getPropertyValue(name).trim() }))
        .filter((t) => t.value && (!kind.numeric || /^\d+$/.test(t.value)));

      if (!tokens.length) {
        root.appendChild(el("p", "No tokens of this kind are declared on this page.", "empty"));
        return;
      }

      const groups = new Map();
      for (const t of tokens) {
        const key = kind.sample === "swatch" ? family(t.name, kind.prefix) : "";
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(t);
      }
      for (const [key, list] of groups) {
        if (key) {
          root.appendChild(el("h3", key));
          list.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
        }
        root.appendChild(this._table(kind, list));
      }
    }

    _table(kind, tokens) {
      const table = document.createElement("table");
      const head = table.createTHead().insertRow();
      for (const [label, col] of [["Sample", "sample"], ["Token", "token"], ["Value", "value"], ["", "copy"]]) {
        const th = document.createElement("th");
        th.scope = "col";
        th.className = `col-${col}`;
        th.textContent = label;
        head.appendChild(th);
      }
      const body = table.createTBody();
      for (const t of tokens) {
        const row = body.insertRow();
        const sampleCell = row.insertCell();
        sampleCell.setAttribute("aria-hidden", "true");
        sampleCell.appendChild(sample(kind.sample, t.name));
        row.insertCell().appendChild(el("code", t.name));
        row.insertCell().appendChild(el("code", t.value));
        const copy = el("button", "Copy");
        copy.type = "button";
        copy.dataset.copy = `var(${t.name})`;
        copy.setAttribute("aria-label", `Copy var(${t.name})`);
        row.insertCell().appendChild(copy);
      }
      return table;
    }

    _onClick(event) {
      const button = event.target.closest("button[data-copy]");
      if (!button || !navigator.clipboard) return;
      navigator.clipboard.writeText(button.dataset.copy).then(() => {
        button.textContent = "Copied";
        setTimeout(() => (button.textContent = "Copy"), 1500);
      });
    }
  }

  function sample(type, name) {
    const v = `var(${name})`;
    const node = document.createElement("div");
    switch (type) {
      case "swatch":
        node.className = "swatch";
        node.style.background = v;
        break;
      case "text":
        node.className = "text";
        node.style.fontSize = v;
        node.textContent = "The quick brown fox";
        break;
      case "weight":
        node.className = "text";
        node.style.fontWeight = v;
        node.textContent = "The quick brown fox";
        break;
      case "bar":
        node.className = "bar";
        node.style.width = v;
        break;
      case "radius":
        node.className = "box";
        node.style.borderRadius = v;
        break;
      case "border":
        node.className = "box";
        node.style.borderWidth = v;
        break;
      case "shadow":
        node.className = "box";
        node.style.boxShadow = v;
        node.style.border = "0";
        break;
    }
    return node;
  }

  function el(tag, text, className) {
    const node = document.createElement(tag);
    node.textContent = text;
    if (className) node.className = className;
    return node;
  }

  function toRegExp(source) {
    if (!source) return null;
    try {
      return new RegExp(source);
    } catch (e) {
      return null;
    }
  }

  if (!customElements.get("lsg-token-reference")) {
    customElements.define("lsg-token-reference", LsgTokenReference);
  }
})();
