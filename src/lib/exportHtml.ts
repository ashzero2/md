// Build a self-contained HTML document for a note (export + print).
// Renders the same markdown pipeline as the app, inlines the app's light
// tokens + prose CSS + KaTeX + highlight styles, and fixes wikilinks to
// relative paths so the exported file is readable standalone.

import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import remarkFrontmatter from "remark-frontmatter";
import remarkRehype from "remark-rehype";
import rehypeKatex from "rehype-katex";
import rehypeStringify from "rehype-stringify";
import { visit } from "unist-util-visit";
import type { Root, Element } from "hast";
import type { Plugin } from "unified";
import { remarkWikilinks } from "./plugins/remark-wikilinks";
import { remarkCallouts } from "./plugins/remark-callouts";

import tokensCss from "../styles/tokens.css?inline";
import proseCss from "../styles/prose.css?inline";
import katexCss from "katex/dist/katex.min.css?inline";
import hljsCss from "highlight.js/styles/github.css?inline";

const PRINTCSS = `
body { margin: 0; background: #fafaf7; }
@media print {
  body { background: #fff; }
  .viewpane { box-shadow: none; margin: 0 auto; padding: 0; }
  h1, h2, h3, table, .callout, pre, blockquote { break-inside: avoid; }
  hr { break-after: page; border: none; margin: 0; }
}
`;

/** Decode a percent-encoded string, returning the input unchanged on error. */
function safeDecodeURIComponent(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/**
 * Rehype plugin: rewrite `vault://` hrefs to sibling `.md` file paths.
 * Uses AST traversal instead of string replacement to correctly handle
 * encoded characters in note titles.
 */
const rehypeRewriteVaultLinks: Plugin<[], Root> = () => (tree) => {
  visit(tree, "element", (node) => {
    const el = node as Element;
    if (el.tagName !== "a") return;
    const href = el.properties?.href;
    if (typeof href !== "string" || !href.startsWith("vault://")) return;
    const raw = href.slice("vault://".length);
    // Only use the path component (before any `#` fragment)
    const hashIdx = raw.indexOf("#");
    const encodedTarget = hashIdx >= 0 ? raw.slice(0, hashIdx) : raw;
    const target = safeDecodeURIComponent(encodedTarget).trim();
    el.properties.href = `${target}.md`;
  });
};

export async function buildExportHtml(markdown: string, title: string): Promise<string> {
  const processor = unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkMath)
    .use(remarkFrontmatter)
    .use(remarkWikilinks)
    .use(remarkCallouts)
    .use(remarkRehype)
    .use(rehypeKatex)
    .use(rehypeRewriteVaultLinks)
    .use(rehypeStringify);

  const body = (await processor.process(markdown)).toString();

  const safeTitle = (title || "note").replace(/[<>]/g, "");

  return `<!doctype html>
<html lang="en" data-theme="light">
<head>
<meta charset="utf-8" />
<title>${safeTitle}</title>
<meta name="color-scheme" content="light" />
<style>
${tokensCss}
${proseCss}
${katexCss}
${hljsCss}
${PRINTCSS}
</style>
</head>
<body class="viewpane-page">
<main class="viewpane">
${body}
</main>
</body>
</html>`;
}