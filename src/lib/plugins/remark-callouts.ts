// Custom remark plugin: Obsidian-style callouts — blockquotes whose first
// line is `> [!note] title` keep the blockquote element but get callout
// classes + a marked title paragraph via standard hProperties, so the
// renderer can style them with plain CSS and components overrides.

import { visit } from "unist-util-visit";
import type { Root } from "mdast";
import type { Plugin } from "unified";

const CALLOUT_RE = /^\s*\[!(\w+)\]\s*(.*)$/;

export const remarkCallouts: Plugin<[], Root> = () => (tree) => {
  visit(tree, "blockquote", (node: any, _index, _parent) => {
    const first = node.children[0];
    if (!first || first.type !== "paragraph") return;
    const textNode = first.children?.[0];
    if (!textNode || textNode.type !== "text") return;

    // Detect the `> [!kind] title` line (may live inside a multiline text).
    const newlineIdx = textNode.value.indexOf("\n");
    const firstLine = newlineIdx === -1 ? textNode.value : textNode.value.slice(0, newlineIdx);
    const m = firstLine.match(CALLOUT_RE);
    if (!m) return;

    const kind = m[1].toLowerCase();
    const title = m[2].trim() || kind.toUpperCase();

    // Body = everything after the `[!kind] title` line of the first paragraph.
    const restStart = newlineIdx === -1 ? firstLine.length : newlineIdx + 1;
    const subtitle = textNode.value.slice(restStart);

    node.children = [
      {
        type: "paragraph",
        data: { hProperties: { className: ["callout-title"] } },
        children: [{ type: "text", value: title }],
      },
      ...(subtitle.trim().length > 0
        ? [{ type: "paragraph", children: [{ type: "text", value: subtitle }] }]
        : []),
      ...node.children.slice(1),
    ];
    node.data = {
      hProperties: { className: ["callout", `callout-${kind}`] },
    };
  });
};