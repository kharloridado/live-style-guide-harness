/* lsg-token-reference.js — the script behind the Live Style Guide's TokenReference Block.
 *
 * Renders every design token of one kind that the page's stylesheets declare on :root / html /
 * body, in declaration order, with a specimen, its live computed value and a copy button. Token
 * names are discovered, not listed here, so a token added to the theme appears on the next
 * publish. Styles: lsg-token-reference.css.
 *
 * The Block calls it from its own lifecycle, with WidgetId = the Id of the Container to render into:
 *   OnReady              LsgTokenReference.init($parameters.WidgetId, { kind, filter, exclude });
 *   OnParametersChanged  LsgTokenReference.update($parameters.WidgetId, { kind, filter, exclude });
 *   OnDestroy            LsgTokenReference.destroy($parameters.WidgetId);
 *
 * Options
 *   kind     color | font-size | font-weight | space | radius | border-size | shadow  (required)
 *   filter   regular expression a token name must match, e.g. "^--color-(primary|neutral)"
 *   exclude  regular expression a token name must not match
 */
(function () {
  "use strict";

  if (window.LsgTokenReference) return;

  const KINDS = {
    color: { prefix: "--color-", sample: "swatch", grouped: true },
    "font-size": { prefix: "--font-size-", sample: "text" },
    "font-weight": { prefix: "--font-", sample: "weight", skip: /^--font-(size|family)-/, numeric: true },
    space: { prefix: "--space-", sample: "bar" },
    radius: { prefix: "--border-radius-", sample: "radius" },
    "border-size": { prefix: "--border-size-", sample: "border" },
    shadow: { prefix: "--shadow-", sample: "shadow" },
  };

  const GLOBAL = /^(?::root|html|body)(?:\[[^\]]*\]|:[\w-]+(?:\([^)]*\))?)*$/;
  const B = "lsg-token-ref";
  const instances = new Map();

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

  function render(host, options) {
    host.textContent = "";
    host.classList.add(`${B}__body`);
    const kind = KINDS[options.kind];
    if (!kind) {
      host.appendChild(el("p", `Unknown token kind "${options.kind}".`, `${B}__empty`));
      return;
    }

    const filter = toRegExp(options.filter);
    const exclude = toRegExp(options.exclude);
    const computed = getComputedStyle(document.documentElement);
    const tokens = discover(kind.prefix)
      .filter((n) => !(kind.skip && kind.skip.test(n)))
      .filter((n) => !filter || filter.test(n))
      .filter((n) => !exclude || !exclude.test(n))
      .map((name) => ({ name, value: computed.getPropertyValue(name).trim() }))
      .filter((t) => t.value && (!kind.numeric || /^\d+$/.test(t.value)));

    if (!tokens.length) {
      host.appendChild(el("p", "No tokens of this kind are declared on this page.", `${B}__empty`));
      return;
    }

    const groups = new Map();
    for (const t of tokens) {
      const key = kind.grouped ? t.name.slice(kind.prefix.length).split("-")[0] : "";
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(t);
    }
    for (const [key, list] of groups) {
      if (key) {
        host.appendChild(el("h3", key, `${B}__group`));
        list.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
      }
      host.appendChild(table(kind, list));
    }
  }

  function table(kind, tokens) {
    const node = document.createElement("table");
    node.className = `${B}__table`;
    const head = node.createTHead().insertRow();
    for (const [label, col] of [["Sample", "sample"], ["Token", "token"], ["Value", "value"], ["", "copy"]]) {
      const th = document.createElement("th");
      th.scope = "col";
      th.className = `${B}__col-${col}`;
      th.textContent = label;
      head.appendChild(th);
    }
    const body = node.createTBody();
    for (const t of tokens) {
      const row = body.insertRow();
      const sampleCell = row.insertCell();
      sampleCell.setAttribute("aria-hidden", "true");
      sampleCell.appendChild(sample(kind.sample, t.name));
      row.insertCell().appendChild(el("code", t.name));
      row.insertCell().appendChild(el("code", t.value));
      const copy = el("button", "Copy", `${B}__copy`);
      copy.type = "button";
      copy.dataset.copy = `var(${t.name})`;
      copy.setAttribute("aria-label", `Copy var(${t.name})`);
      row.insertCell().appendChild(copy);
    }
    return node;
  }

  function sample(type, name) {
    const v = `var(${name})`;
    const node = document.createElement("div");
    node.className = `${B}__sample ${B}__sample--${type}`;
    switch (type) {
      case "swatch":
        node.style.background = v;
        break;
      case "text":
        node.style.fontSize = v;
        node.textContent = "The quick brown fox";
        break;
      case "weight":
        node.style.fontWeight = v;
        node.textContent = "The quick brown fox";
        break;
      case "bar":
        node.style.width = v;
        break;
      case "radius":
        node.style.borderRadius = v;
        break;
      case "border":
        node.style.borderWidth = v;
        break;
      case "shadow":
        node.style.boxShadow = v;
        break;
    }
    return node;
  }

  function onClick(event) {
    const button = event.target.closest(`.${B}__copy`);
    if (!button || !navigator.clipboard) return;
    navigator.clipboard.writeText(button.dataset.copy).then(() => {
      button.textContent = "Copied";
      setTimeout(() => (button.textContent = "Copy"), 1500);
    });
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

  window.LsgTokenReference = {
    /* A second init for the same widget re-renders instead of binding twice. */
    init(widgetId, options) {
      const host = document.getElementById(widgetId);
      if (!host) return;
      const existing = instances.get(widgetId);
      if (existing && existing.host === host) return this.update(widgetId, options);
      if (existing) this.destroy(widgetId);
      host.addEventListener("click", onClick);
      instances.set(widgetId, { host, options: { ...options } });
      /* Stylesheets attached after the Block still count: render once they have applied. */
      requestAnimationFrame(() => {
        const instance = instances.get(widgetId);
        if (instance && instance.host === host) render(host, instance.options);
      });
    },

    update(widgetId, options) {
      const instance = instances.get(widgetId);
      if (!instance) return this.init(widgetId, options);
      instance.options = { ...instance.options, ...options };
      render(instance.host, instance.options);
    },

    /* Re-read the tokens of one instance, or of all of them (e.g. after a theme switch). */
    refresh(widgetId) {
      for (const id of widgetId ? [widgetId] : [...instances.keys()]) {
        const instance = instances.get(id);
        if (instance) render(instance.host, instance.options);
      }
    },

    destroy(widgetId) {
      const instance = instances.get(widgetId);
      if (!instance) return;
      instance.host.removeEventListener("click", onClick);
      instance.host.textContent = "";
      instances.delete(widgetId);
    },
  };
})();
