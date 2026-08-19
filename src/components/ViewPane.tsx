// Rendered markdown (view mode) — see src/lib/markdown.tsx.

import { MarkdownView } from "../lib/markdown";
import type { OpenNoteOptions } from "../lib/open-intent";

interface Props {
  content: string;
  onNavigate: (target: string, options?: OpenNoteOptions) => void;
  onToggleTask?: (next: string) => void;
}

export default function ViewPane({ content, onNavigate, onToggleTask }: Props) {
  return (
    <div className="viewpane">
      <MarkdownView
        source={content}
        onNavigate={onNavigate}
        onToggleTask={onToggleTask}
      />
    </div>
  );
}
