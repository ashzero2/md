// Cmd+P quick switcher: fuzzy note-title lookup + create-new-note flow.
// Built on cmdk for keyboard navigation (arrows/Enter/Esc).

import { useCallback, useEffect, useState } from "react";
import { Command } from "cmdk";
import { createNote, quickSwitcher } from "../lib/ipc";
import type { NoteMeta } from "../lib/types";

interface Props {
  open: boolean;
  onClose: () => void;
  onOpenNote: (path: string) => void;
  onStatus: (msg: string) => void;
  /** Vault-relative folder for new notes, or null for vault root. */
  createFolder: string | null;
  onOpenSettings: () => void;
}

export default function CommandPalette({
  open,
  onClose,
  onOpenNote,
  onStatus,
  createFolder,
  onOpenSettings,
}: Props) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<NoteMeta[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setResults([]);
  }, [open]);

  // Debounced quick-switcher lookup.
  useEffect(() => {
    if (!open) return;
    const q = query.trim();
    if (!q) {
      setResults([]);
      return;
    }
    setLoading(true);
    const timer = setTimeout(() => {
      quickSwitcher(q)
        .then(setResults)
        .finally(() => setLoading(false));
    }, 120);
    return () => clearTimeout(timer);
  }, [query, open]);

  const handleCreate = useCallback(async () => {
    try {
      const note = await createNote(query.trim(), createFolder);
      onClose();
      onOpenNote(note.path);
      onStatus(
        createFolder ? `Created ${note.title} in ${createFolder}` : `Created ${note.title}`,
      );
    } catch (e) {
      onStatus(String(e));
    }
  }, [query, createFolder, onClose, onOpenNote, onStatus]);

  if (!open) return null;

  return (
    <div className="palette-overlay" onMouseDown={onClose}>
      <div className="palette" onMouseDown={(e) => e.stopPropagation()}>
        <Command>
          <input
            className="palette-input"
            placeholder="Jump to a note…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoFocus
          />
          <Command.List className="palette-list">
            {results.length === 0 && !loading && query.trim() && (
              <Command.Empty className="palette-empty">
                No matching notes
              </Command.Empty>
            )}
            {results.map((n) => (
              <Command.Item
                key={n.path}
                value={`note:${n.title}`}
                className="palette-item"
                onSelect={() => {
                  onClose();
                  onOpenNote(n.path);
                }}
              >
                <span className="palette-item-title">{n.title}</span>
                <span className="palette-item-path">{n.path}</span>
              </Command.Item>
            ))}
            {query.trim() && (
              <Command.Item
                value={`create:${query}`}
                className="palette-item palette-create"
                onSelect={() => void handleCreate()}
              >
                <span className="palette-item-title">Create note: “{query.trim()}”</span>
              </Command.Item>
            )}
            <Command.Item
              value="cmd:settings"
              className="palette-item"
              onSelect={() => {
                onClose();
                onOpenSettings();
              }}
            >
              <span className="palette-item-title">Open Settings…</span>
              <span className="palette-item-path">⌘,</span>
            </Command.Item>
          </Command.List>
        </Command>
      </div>
    </div>
  );
}