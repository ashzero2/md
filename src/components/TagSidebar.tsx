// Tag sidebar: all tags with counts; click filters the note list.

import { useEffect, useState } from "react";
import { listTags } from "../lib/ipc";
import type { TagCount } from "../lib/types";

interface Props {
  activeTag: string | null;
  onSelectTag: (tag: string | null) => void;
}

export default function TagSidebar({ activeTag, onSelectTag }: Props) {
  const [tags, setTags] = useState<TagCount[]>([]);

  const refresh = () => {
    listTags().then(setTags).catch(() => {});
  };

  useEffect(() => {
    refresh();
    // Refresh when tags might have changed (e.g. after vault-changed events).
    const onEvent = () => refresh();
    window.addEventListener("vault-changed-ui", onEvent);
    return () => window.removeEventListener("vault-changed-ui", onEvent);
  }, []);

  if (tags.length === 0) return null;

  return (
    <div className="tags-section">
      <h2>Tags</h2>
      <ul className="tags-list">
        {tags.map((t) => (
          <li key={t.tag}>
            <button
              className={activeTag === t.tag ? "active" : ""}
              onClick={() => onSelectTag(activeTag === t.tag ? null : t.tag)}
            >
              <span className="tag-name">#{t.tag}</span>
              <span className="tag-count">{t.count}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}