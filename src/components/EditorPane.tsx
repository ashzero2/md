// Markdown source editor (edit mode) — CodeMirror 6 via @uiw/react-codemirror.

import CodeMirror from "@uiw/react-codemirror";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { languages } from "@codemirror/language-data";
import { EditorView } from "@codemirror/view";
import { useEditorStore } from "../store/editor";

// Neutral editor theme for now; Phase 6 maps this to the app's design tokens.
const editorTheme = EditorView.theme({
  "&": { height: "100%", fontSize: "15px" },
  ".cm-content": { fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" },
  ".cm-gutters": { backgroundColor: "transparent", border: "none" },
}, { dark: false });

export default function EditorPane() {
  const content = useEditorStore((s) => s.content);
  const setContent = useEditorStore((s) => s.setContent);

  return (
    <CodeMirror
      value={content}
      onChange={setContent}
      height="100%"
      style={{ height: "100%" }}
      extensions={[
        markdown({ base: markdownLanguage, codeLanguages: languages }),
        EditorView.lineWrapping,
        editorTheme,
      ]}
    />
  );
}