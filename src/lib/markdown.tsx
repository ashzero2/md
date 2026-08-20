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
import { eventOpensInBackground, type OpenNoteOptions } from "./open-intent";
import "katex/dist/katex.min.css";
import "highlight.js/styles/github-dark.css";

export interface MarkdownViewProps {
  source: string;
  onNavigate: (target: string, options?: OpenNoteOptions) => void;
  /** Called with the toggled markdown when a task checkbox is clicked in view. */
  onToggleTask?: (next: string) => void;
}

/** Decode a percent-encoded string, returning the input unchanged on error. */
function safeDecodeURIComponent(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

function components(opts: {
  onNavigate: (target: string, options?: OpenNoteOptions) => void;
  onToggleTask: (next: string) => void;
  source: string;
}): Components {
  const { onNavigate, onToggleTask, source } = opts;
  return {
    // `[[wikilink]]` → standard <a href="vault://encoded-target"> from the plugin.
    a: ({ href, children }: React.ComponentPropsWithoutRef<"a">) => {
      if (typeof href === "string" && href.startsWith("vault://")) {
        const raw = href.slice("vault://".length);
        // Use indexOf rather than split so we only split on the first `#`
        // (the fragment separator). The target itself may contain encoded `%23`.
        const hashIdx = raw.indexOf("#");
        const encodedTarget = hashIdx >= 0 ? raw.slice(0, hashIdx) : raw;
        const decodedTarget = safeDecodeURIComponent(encodedTarget);
        return (
          <a
            className="wikilink"
            href="#"
            title={decodedTarget}
            onClick={(e) => {
              e.preventDefault();
              onNavigate(decodedTarget, { background: eventOpensInBackground(e) });
            }}
            onAuxClick={(e) => {
              if (e.button !== 1) return;
              e.preventDefault();
              onNavigate(decodedTarget, { background: true });
            }}
          >
            {children}
          </a>
        );
      }
      return <a href={href}>{children}</a>;
    },
    // `> [!kind] title` → blockquote with callout classes.
    blockquote: ({ className, children }: React.ComponentPropsWithoutRef<"blockquote">) => {
      const cls = (className ?? "").split(" ");
      if (cls.includes("callout")) {
        const kind = cls.find((x) => x.startsWith("callout-"))?.replace("callout-", "");
        return (
          <div className={`callout callout-${kind ?? "note"}`} data-kind={kind ?? "note"}>
            <div className="callout-body">{children}</div>
          </div>
        );
      }
      return <blockquote className={className}>{children}</blockquote>;
    },
    // Callout title paragraph (marked by the plugin with .callout-title).
    p: ({ className, children }: React.ComponentPropsWithoutRef<"p">) => {
      if (className === "callout-title") {
        return <div className="callout-title">{children}</div>;
      }
      return <p className={className}>{children}</p>;
    },
    table: ({ children }: React.ComponentPropsWithoutRef<"table">) => (
      <div className="table-wrap">
        <table>{children}</table>
      </div>
    ),
    pre: ({ children }: React.ComponentPropsWithoutRef<"pre">) => (
      <pre className="code-block">{children}</pre>
    ),
    // Task-list items: capture the source char offset of the `[ ]`/`[x]`
    // marker (via the li's mdast position) so the checkbox `<input>` child
    // can toggle it. react-markdown renders that input as disabled by default.
    li: ({ node, children, ...rest }: React.ComponentPropsWithoutRef<"li"> & { node?: { position?: { start?: { offset?: number }; end?: { offset?: number } } } }) => {
      const pos = node?.position;
      let toggleAt = -1;
      if (pos && typeof pos.start?.offset === "number" && typeof pos.end?.offset === "number") {
        const slice = source.slice(pos.start.offset, pos.end.offset);
        const m = slice.match(/^(\s*(?:[-+*]|\d+\.)\s+)\[([ x])\]/);
        if (m && m.index !== undefined) {
          toggleAt = pos.start.offset + m.index + m[1].length + 1;
        }
      }
      return (
        <li {...rest} data-toggle-at={toggleAt >= 0 ? String(toggleAt) : undefined}>
          {children}
        </li>
      );
    },
    // Checkbox toggle in view mode: flip the marker in the source and save.
    // Reads its own li's data-toggle-at (set right above) at click time.
    input: ({ type, checked, ...rest }: React.ComponentPropsWithoutRef<"input">) => {
      if (type !== "checkbox") {
        return <input type={type} {...rest} />;
      }
      return (
        <input
          type="checkbox"
          checked={!!checked}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
            const li = (e.currentTarget as HTMLInputElement).closest("li");
            const at = li ? Number(li.getAttribute("data-toggle-at")) : NaN;
            if (!Number.isFinite(at) || at < 0 || at >= source.length) return;
            const cur = source[at];
            if (cur !== " " && cur !== "x") return;
            const next = cur === "x" ? " " : "x";
            onToggleTask(source.slice(0, at) + next + source.slice(at + 1));
          }}
        />
      );
    },
  };
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
