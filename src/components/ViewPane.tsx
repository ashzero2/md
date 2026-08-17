// Rendered markdown (view mode) — see src/lib/markdown.tsx.

import { MarkdownView } from "../lib/markdown";

interface Props {
  content: string;
  onNavigate: (target: string) => void;
}

export default function ViewPane({ content, onNavigate }: Props) {
  return (
    <div className="viewpane">
      <MarkdownView source={content} onNavigate={onNavigate} />
    </div>
  );
}