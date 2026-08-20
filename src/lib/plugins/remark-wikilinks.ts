// Custom remark plugin: turn `[[target|alias]]` / `[[target#heading]]` text
// into standard mdast `link` nodes with a `vault://` URL scheme. The renderer
// intercepts links with that scheme and performs in-app navigation instead.
//
// Using a known node type (link) is intentional: unknown AST node types get
// flattened to empty <div>s by mdast-util-to-hast on the way to react-markdown.

import { visit } from "unist-util-visit";
import type { Root, Text, Link, PhrasingContent } from "mdast";
import type { Plugin } from "unified";

const WIKILINK_RE = /\[\[([^\[\]\n]+)\]\]/g;

export const VAULT_SCHEME = "vault://";

export const remarkWikilinks: Plugin<[], Root> = () => (tree) => {
  visit(tree, "text", (node: Text, index, parent) => {
    if (typeof node.value !== "string") return;
    const matches = [...node.value.matchAll(WIKILINK_RE)];
    if (matches.length === 0) return;

    const children: PhrasingContent[] = [];
    let last = 0;
    for (const m of matches) {
      if (m.index !== undefined && m.index > last) {
        children.push({ type: "text", value: node.value.slice(last, m.index) });
      }
      const [targetPart, aliasRaw] = (m[1] ?? "")
        .split("|")
        .map((s: string) => s.trim());
      const [target, headingRaw] = targetPart.split("#");
      const targetName = (target ?? targetPart).trim();
      // Encode the target so titles with %, spaces, unicode, etc. are safe in a URL.
      // The heading fragment is also encoded; # stays as the separator.
      const url =
        `${VAULT_SCHEME}${encodeURIComponent(targetName)}` +
        (headingRaw?.trim() ? `#${encodeURIComponent(headingRaw.trim())}` : "");
      children.push({
        type: "link",
        url,
        title: headingRaw?.trim() || undefined,
        children: [{ type: "text", value: aliasRaw ?? targetName }],
      } as Link);
      last = (m.index ?? 0) + m[0].length;
    }
    if (last < node.value.length) {
      children.push({ type: "text", value: node.value.slice(last) });
    }
    if (parent && typeof index === "number") {
      parent.children.splice(index, 1, ...children);
    }
  });
};