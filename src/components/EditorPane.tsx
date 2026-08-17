// Markdown source editor (edit mode) — CodeMirror 6 via @uiw/react-codemirror.
// Themed from the app's design tokens so edit mode matches the rendered view.

import CodeMirror from "@uiw/react-codemirror";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { languages } from "@codemirror/language-data";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { tags } from "@lezer/highlight";
import { EditorView } from "@codemirror/view";
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

// Syntax highlighting mapped to the design tokens.
const markdownHighlight = HighlightStyle.define([
  { tag: tags.heading, fontWeight: "600", color: "var(--ink)" },
  { tag: tags.emphasis, fontStyle: "italic" },
  { tag: tags.strong, fontWeight: "700" },
  { tag: tags.link, color: "var(--accent-strong)" },
  { tag: tags.url, color: "var(--accent-strong)", textDecoration: "underline" },
  { tag: tags.monospace, color: "var(--accent-strong)", fontFamily: "var(--font-mono)" },
  { tag: tags.quote, color: "var(--ink-2)", fontStyle: "italic" },
  { tag: tags.strikethrough, textDecoration: "line-through" },
  { tag: tags.meta, color: "var(--ink-3)" },
  { tag: tags.list, color: "var(--ink-2)" },
  { tag: tags.comment, color: "var(--ink-3)" },
]);

export default function EditorPane() {
  const content = useEditorStore((s) => s.content);
  const setContent = useEditorStore((s) => s.setContent);

  return (
    <div className="editor-wrap">
      <CodeMirror
        value={content}
        onChange={setContent}
        height="100%"
        style={{ height: "100%" }}
        basicSetup={{
          // Cmd+F is ours (full-screen search); remove CM's plain search panel.
          searchKeymap: false,
        }}
        extensions={[
          markdown({ base: markdownLanguage, codeLanguages: languages }),
          EditorView.lineWrapping,
          editorTheme,
          syntaxHighlighting(markdownHighlight),
        ]}
      />
    </div>
  );
}