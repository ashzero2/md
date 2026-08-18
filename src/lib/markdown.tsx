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
  /** Called with the toggled markdown when a task checkbox is clicked in view. */
  onToggleTask?: (next: string) => void;
}

function components(opts: {
  onNavigate: (target: string) => void;
  onToggleTask: (next: string) => void;
  source: string;
}): Components {
  const { onNavigate, onToggleTask, source } = opts;
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
    // Task-list rows: clicking toggles the `[ ]` / `[x]` marker in the source
    // (react-markdown gives the li the mdast position → exact char offset).
    li: ({ node, children, ...rest }: any) => {
      const pos = node?.position;
      let toggleAt = -1;
      if (pos && typeof pos.start?.offset === "number" && typeof pos.end?.offset === "number") {
        const slice = source.slice(pos.start.offset, pos.end.offset);
        const m = slice.match(/^(\s*(?:[-+*]|\d+\.)\s+)\[([ x])\]/);
        if (m && m.index !== undefined) {
          // char offset of the space/x inside the `[ ]` marker
          toggleAt = pos.start.offset + m.index + m[1].length + 1;
        }
      }
      if (toggleAt < 0) {
        return <li {...rest}>{children}</li>;
      }
      return (
        <li
          {...rest}
          className="task-toggle"
          onClick={(e: React.MouseEvent) => {
            e.preventDefault();
            const cur = source[toggleAt];
            const next = cur === "x" ? " " : "x";
            const updated = source.slice(0, toggleAt) + next + source.slice(toggleAt + 1);
            onToggleTask(updated);
          }}
        >
          {children}
        </li>
      );
    },
  };
  return c as unknown as Components;
}

export function MarkdownView({ source, onNavigate, onToggleTask }: MarkdownViewProps) {
  const noop = (n: string) => {
    void n;
  };
  const c = components({
    onNavigate,
    onToggleTask: onToggleTask ?? noop,
    source,
  });
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm, remarkMath, remarkFrontmatter, remarkWikilinks, remarkCallouts]}
      rehypePlugins={[rehypeKatex, rehypeHighlight]}
      urlTransform={(url) =>
        url.startsWith("vault://") ? url : defaultUrlTransform(url)
      }
      components={c}
    >
      {source}
    </ReactMarkdown>
  );
}