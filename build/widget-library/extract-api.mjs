#!/usr/bin/env node
/* extract-api.mjs — reads every widget of the osfe widget library and returns the API its docs
 * page shows: each property's Studio name, description, type, default and kind (Variable,
 * Property, Attribute, Event, Placeholder). The API tables are generated from the code that
 * ships, so they cannot drift from it.
 *
 * It reads what osfe itself reads: the library's index exports (`export { default as X } from
 * "./src/X"`), each widget's `I<Name>Props` interface with its `NamedProperty<T, "Studio name",
 * "Description">` members and `// Section` comments, the defaults in its parameter destructuring,
 * and the `withName({ name, description })` call.
 *
 *   node build/widget-library/extract-api.mjs     print the API as JSON */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { loadLibrary, loadTypeScript } from "./lib.mjs";

function reader(ts) {
  const unwrap = (node, wrapper) =>
    ts.isTypeReferenceNode(node) && node.typeName.getText() === wrapper ? node.typeArguments?.[0] : undefined;
  const literal = (node) =>
    node && ts.isLiteralTypeNode(node) && ts.isStringLiteral(node.literal) ? node.literal.text : "";

  function describeType(node) {
    const text = node.getText().replace(/\s+/g, " ");
    if (ts.isUnionTypeNode(node) && node.types.every((t) => literal(t))) return { type: "Enum", options: node.types.map(literal) };
    if (ts.isFunctionTypeNode(node)) {
      const params = node.parameters.map((p) => `${p.name.getText()}: ${p.type?.getText() ?? "unknown"}`);
      return { type: `(${params.join(", ")})` };
    }
    const variable = unwrap(node, "Variable");
    if (variable) return { type: `Variable<${describeType(variable).type}>` };
    if (ts.isTypeReferenceNode(node) && node.typeName.getText() === "Attribute") {
      return { type: `Attribute → ${node.typeArguments?.[2]?.getText() ?? "unknown"}` };
    }
    const map = {
      string: "Text",
      boolean: "Boolean",
      number: "Decimal",
      "unknown[]": "Record List",
      StyleProperty: "Text",
      "React.ReactNode": "Placeholder",
    };
    return { type: map[text] ?? text };
  }

  /* A `// Events` style comment above a member opens a section, as in osfe's own templates. */
  function sectionOf(member, source, current) {
    for (const c of ts.getLeadingCommentRanges(source.text, member.getFullStart()) ?? []) {
      const m = /^\/\/ ([A-Z][a-z]+(?: [a-z]+)*)$/.exec(source.text.slice(c.pos, c.end).trim());
      if (m) current = m[1];
    }
    return current;
  }

  return function extract(file) {
    const source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
    let iface;
    const defaults = new Map();
    let name = "";
    let description = "";
    const visit = (node) => {
      if (ts.isInterfaceDeclaration(node) && /^I\w+Props$/.test(node.name.text)) iface = node;
      if (ts.isObjectBindingPattern(node) && !defaults.size) {
        for (const el of node.elements) if (el.initializer) defaults.set(el.name.getText(), el.initializer.getText());
      }
      if (ts.isCallExpression(node) && node.expression.getText() === "withName") {
        const meta = node.arguments[0];
        if (meta && ts.isObjectLiteralExpression(meta)) {
          for (const p of meta.properties) {
            if (!ts.isPropertyAssignment(p) || !ts.isStringLiteralLike(p.initializer)) continue;
            if (p.name.getText() === "name") name = p.initializer.text;
            if (p.name.getText() === "description") description = p.initializer.text;
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
    if (!iface || !name) return undefined;

    let section = "Properties";
    const props = [];
    for (const member of iface.members) {
      section = sectionOf(member, source, section);
      if (!ts.isPropertySignature(member) || !member.type) continue;
      const key = member.name.getText();
      let typeNode = member.type;
      let studioName = key;
      let text = "";
      if (ts.isTypeReferenceNode(typeNode) && typeNode.typeName.getText() === "NamedProperty") {
        const [inner, osName, desc] = typeNode.typeArguments ?? [];
        typeNode = inner;
        studioName = literal(osName) || key;
        text = literal(desc);
      } else if (ts.isTypeReferenceNode(typeNode)) {
        continue; // IsValid / ValidationMessage and the like: wired by the platform, not set in Studio
      }
      const preview = unwrap(typeNode, "AffectsPreview");
      const { type, options } = describeType(preview ?? typeNode);
      props.push({
        key,
        name: studioName,
        description: text,
        type: section === "Placeholders" || section === "Iterators" ? "Placeholder" : type,
        options,
        defaultValue: defaults.get(key),
        required: !member.questionToken,
        affectsPreview: Boolean(preview),
        section,
      });
    }
    return { name, description, props };
  };
}

/** { <exported widget name>: { name, description, props[] } } for every widget the index exports. */
export function extractApi(library = loadLibrary()) {
  const ts = loadTypeScript(library.source);
  const extract = reader(ts);
  const indexFile = join(library.source, library.settings.index ?? "index.ts");
  const index = readFileSync(indexFile, "utf8");
  const out = {};
  for (const [, exported, rel] of index.matchAll(/export \{ default as (\w+) \} from "(\.[^"]+)"/g)) {
    const base = resolve(dirname(indexFile), rel);
    const file = [".tsx", ".ts", ""].map((ext) => base + ext).find((f) => existsSync(f));
    const widget = file && extract(file);
    if (widget) out[exported] = widget;
  }
  return out;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.log(JSON.stringify(extractApi(), null, 2));
}
