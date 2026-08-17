// Markdown source editor (edit mode) — CodeMirror 6 via @uiw/react-codemirror.
// Themed from the app's design tokens so edit mode matches the rendered view.

import CodeMirror from "@uiw/react-codemirror";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { languages } from "@codemirror/language-data";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { tags } from "@lezer/highlight";
import { EditorView } from "@codemirror/view";
import { autocompletion, type CompletionContext, type CompletionResult } from "@codemirror/autocomplete";
import { useEffect, useRef } from "react";
import { listFiles } from "../lib/ipc";
import { useEditorStore } from "../store/editor";

const editorTheme = EditorView.theme(
  {
    "&": {
      height: "100%",
      fontSize: "16px",
      backgroundColor: "transparent",
      color: "var(--ink)",
    },
    ".cm-scroller": {
      fontFamily: "var(--font-serif)",
      lineHeight: "1.7",
      padding: "2.2rem 0 6rem",
    },
    ".cm-content": {
      caretColor: "var(--accent)",
      maxWidth: "40rem",
      margin: "0 auto",
      padding: "0 1.5rem",
    },
    ".cm-cursor, .cm-dropCursor": {
      borderLeftColor: "var(--accent)",
      borderLeftWidth: "1.5px",
    },
    "&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, ::selection":
      {
        backgroundColor: "var(--selection) !important",
      },
    ".cm-gutters": {
      backgroundColor: "transparent",
      color: "var(--ink-3)",
      border: "none",
    },
    ".cm-activeLine": { backgroundColor: "transparent" },
    ".cm-activeLineGutter": { backgroundColor: "transparent" },
    ".cm-matchingBracket": {
      backgroundColor: "var(--accent-tint)",
      outline: "1px solid var(--hairline-strong)",
      borderRadius: "2px",
    },
    ".cm-line": { padding: "0 2px" },
  },
  { dark: false },
);

// Syntax highlighting mapped to the design tokens (editorial, muted —
// covers the common code tags so fenced blocks stay readable in dark mode).
const markdownHighlight = HighlightStyle.define([
  // markdown structure
  { tag: tags.heading, fontWeight: "600", color: "var(--ink)" },
  { tag: [tags.heading1, tags.heading2, tags.heading3], fontWeight: "600" },
  { tag: tags.emphasis, fontStyle: "italic" },
  { tag: tags.strong, fontWeight: "700" },
  { tag: tags.strikethrough, textDecoration: "line-through" },
  { tag: tags.link, color: "var(--accent-strong)" },
  { tag: tags.url, color: "var(--accent-strong)", textDecoration: "underline" },
  { tag: tags.quote, color: "var(--ink-2)", fontStyle: "italic" },
  { tag: tags.meta, color: "var(--ink-3)" },
  { tag: tags.list, color: "var(--ink-2)" },
  { tag: tags.monospace, color: "var(--accent-strong)", fontFamily: "var(--font-mono)" },
  { tag: tags.contentSeparator, color: "var(--ink-3)" },
  // code / language tokens (fenced blocks)
  { tag: tags.comment, color: "var(--hl-comment)", fontStyle: "italic" },
  { tag: tags.string, color: "var(--hl-string)" },
  { tag: [tags.number, tags.integer, tags.float], color: "var(--hl-number)" },
  { tag: tags.bool, color: "var(--accent-strong)" },
  { tag: tags.keyword, color: "var(--accent-strong)" },
  { tag: [tags.typeName, tags.className], color: "var(--hl-type)" },
  { tag: [tags.function(tags.variableName), tags.function(tags.propertyName)], color: "var(--hl-fn)", fontWeight: "600" },
  { tag: [tags.propertyName, tags.attributeName], color: "var(--hl-props)" },
  { tag: [tags.operator, tags.operatorKeyword], color: "var(--hl-op)" },
  { tag: [tags.punctuation, tags.separator, tags.bracket], color: "var(--hl-punc)" },
  { tag: [tags.tagName, tags.definition(tags.tagName)], color: "var(--hl-tag)" },
  { tag: tags.atom, color: "var(--accent-strong)" },
  { tag: [tags.self, tags.null], color: "var(--accent-strong)" },
  { tag: tags.invalid, color: "var(--danger)" },
]);

// Wikilink completion: offer note titles after `[[`.
function wikilinkCompletions(titles: () => string[]) {
  return (context: CompletionContext): CompletionResult | null => {
    const word = context.matchBefore(/\[\[[^\[\]]*$/);
    if (!word || (word.from === word.to && !context.explicit)) return null;
    const query = word.text.replace(/^\[\[/, "").toLowerCase();
    const options = titles()
      .filter((t) => t.toLowerCase().includes(query))
      .slice(0, 20)
      .map((t) => ({ label: t, detail: "note", apply: `[[${t}]]` }));
    return { from: word.from, options };
  };
}

export default function EditorPane() {
  const content = useEditorStore((s) => s.content);
  const setContent = useEditorStore((s) => s.setContent);
  const titlesRef = useRef<string[]>([]);

  // Refresh the completion dictionary when the vault/notes change.
  useEffect(() => {
    listFiles()
      .then((notes) => {
        titlesRef.current = notes.map((n) => n.title);
      })
      .catch(() => {});
  }, [content]);

  return (
    <div className="editor-wrap">
      <CodeMirror
        value={content}
        onChange={setContent}
        height="100%"
        style={{ height: "100%" }}
        theme="none"
        basicSetup={{
          // Cmd+F is ours (full-screen search); remove CM's plain search panel.
          searchKeymap: false,
        }}
        extensions={[
          markdown({ base: markdownLanguage, codeLanguages: languages }),
          EditorView.lineWrapping,
          editorTheme,
          syntaxHighlighting(markdownHighlight),
          autocompletion({ override: [wikilinkCompletions(() => titlesRef.current)] }),
        ]}
      />
    </div>
  );
}