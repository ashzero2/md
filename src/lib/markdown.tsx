// Markdown rendering pipeline (view mode). Custom plugins for wikilinks and
// callouts; GFM + math (KaTeX) + syntax-highlighted code blocks.

import ReactMarkdown, { defaultUrlTransform, type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import remarkFrontmatter from "remark-frontmatter";
import rehypeKatex from "rehype-katex";
import rehypeHighlight from "rehype-highlight";
import { remarkWikilinks } from "./plugins/remark-wikilinks";
import { remarkCallouts } from "./plugins/remark-callouts";
import "katex/dist/katex.min.css";
import "highlight.js/styles/github-dark.css";

export interface MarkdownViewProps {
  source: string;
  onNavigate: (target: string) => void;
}

function components(onNavigate: (target: string) => void): Components {
  const c: Record<string, any> = {
    // `[[wikilink]]` → standard <a href="vault://target"> from the plugin.
    a: ({ href, children }: any) => {
      if (typeof href === "string" && href.startsWith("vault://")) {
        const raw = href.slice("vault://".length);
        const [target, heading] = raw.split("#");
        return (
          <a
            className="wikilink"
            href="#"
            title={heading ? `${decodeURIComponent(target)} # ${heading}` : decodeURIComponent(target)}
            onClick={(e) => {
              e.preventDefault();
              onNavigate(decodeURIComponent(target));
            }}
          >
            {children}
          </a>
        );
      }
      return <a href={href}>{children}</a>;
    },
    // `> [!kind] title` → blockquote with callout classes.
    blockquote: ({ className, children }: any) => {
      const cls = (className ?? "").split(" ");
      if (cls.includes("callout")) {
        const kind = cls.find((x: string) => x.startsWith("callout-"))?.replace("callout-", "");
        return (
          <div className={`callout callout-${kind ?? "note"}`} data-kind={kind ?? "note"}>
            <div className="callout-body">{children}</div>
          </div>
        );
      }
      return <blockquote className={className}>{children}</blockquote>;
    },
    // Callout title paragraph (marked by the plugin with .callout-title).
    p: ({ className, children }: any) => {
      if (className === "callout-title") {
        return <div className="callout-title">{children}</div>;
      }
      return <p className={className}>{children}</p>;
    },
    table: ({ children }: any) => (
      <div className="table-wrap">
        <table>{children}</table>
      </div>
    ),
    pre: ({ children }: any) => <pre className="code-block">{children}</pre>,
  };
  return c as unknown as Components;
}

export function MarkdownView({ source, onNavigate }: MarkdownViewProps) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm, remarkMath, remarkFrontmatter, remarkWikilinks, remarkCallouts]}
      rehypePlugins={[rehypeKatex, rehypeHighlight]}
      urlTransform={(url) =>
        url.startsWith("vault://") ? url : defaultUrlTransform(url)
      }
      components={components(onNavigate)}
    >
      {source}
    </ReactMarkdown>
  );
}