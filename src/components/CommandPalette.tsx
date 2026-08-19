// Cmd+P quick switcher: fuzzy note-title lookup + create-new-note flow.
// Built on cmdk for keyboard navigation (arrows/Enter/Esc).

import { useCallback, useEffect, useRef, useState } from "react";
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
  /** Whether a vault is open (gates vault-only commands). */
  vaultOpen: boolean;
  onOpenDiagnostics: (tab: "broken" | "orphan") => void;
  /** Path of the currently open note, or null (gates note commands). */
  activeNotePath: string | null;
  onRenameActive: () => void;
  onDeleteActive: () => void;
  onShowBacklinks: () => void;
  onOpenSearch: () => void;
  onRebuildIndex: () => void;
  onExportHtml: () => void;
  onPrintNote: () => void;
}

export default function CommandPalette({
  open,
  onClose,
  onOpenNote,
  onStatus,
  createFolder,
  onOpenSettings,
  vaultOpen,
  onOpenDiagnostics,
  activeNotePath,
  onRenameActive,
  onDeleteActive,
  onShowBacklinks,
  onOpenSearch,
  onRebuildIndex,
  onExportHtml,
  onPrintNote,
}: Props) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<NoteMeta[]>([]);
  const [loading, setLoading] = useState(false);
  const reqId = useRef(0);

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
    const id = ++reqId.current;
    setLoading(true);
    const timer = setTimeout(() => {
      quickSwitcher(q)
        .then((r) => {
          if (reqId.current !== id) return; // stale
          setResults(r);
          setLoading(false);
        })
        .catch(() => setLoading(false));
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
            <Command.Group heading="Commands">
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
            {vaultOpen && (
              <>
                <Command.Item
                  value="cmd:search"
                  className="palette-item"
                  onSelect={() => {
                    onClose();
                    onOpenSearch();
                  }}
                >
                  <span className="palette-item-title">Search all notes</span>
                  <span className="palette-item-path">⌘F</span>
                </Command.Item>
                <Command.Item
                  value="cmd:rebuild"
                  className="palette-item"
                  onSelect={() => {
                    onClose();
                    onRebuildIndex();
                  }}
                >
                  <span className="palette-item-title">Rebuild index</span>
                </Command.Item>
                <Command.Item
                  value="cmd:broken"
                  className="palette-item"
                  onSelect={() => {
                    onClose();
                    onOpenDiagnostics("broken");
                  }}
                >
                  <span className="palette-item-title">Show broken links</span>
                </Command.Item>
                <Command.Item
                  value="cmd:orphan"
                  className="palette-item"
                  onSelect={() => {
                    onClose();
                    onOpenDiagnostics("orphan");
                  }}
                >
                  <span className="palette-item-title">Show orphan notes</span>
                </Command.Item>
              </>
            )}
            {vaultOpen && activeNotePath && (
              <>
                <Command.Item
                  value="cmd:rename-active"
                  className="palette-item"
                  onSelect={() => {
                    onClose();
                    onRenameActive();
                  }}
                >
                  <span className="palette-item-title">Rename current note…</span>
                </Command.Item>
                <Command.Item
                  value="cmd:delete-active"
                  className="palette-item"
                  onSelect={() => {
                    onClose();
                    onDeleteActive();
                  }}
                >
                  <span className="palette-item-title">Delete current note…</span>
                </Command.Item>
                <Command.Item
                  value="cmd:backlinks"
                  className="palette-item"
                  onSelect={() => {
                    onClose();
                    onShowBacklinks();
                  }}
                >
                  <span className="palette-item-title">Show backlinks</span>
                </Command.Item>
                <Command.Item
                  value="cmd:export"
                  className="palette-item"
                  onSelect={() => {
                    onClose();
                    onExportHtml();
                  }}
                >
                  <span className="palette-item-title">Export current note as HTML…</span>
                </Command.Item>
                <Command.Item
                  value="cmd:print"
                  className="palette-item"
                  onSelect={() => {
                    onClose();
                    onPrintNote();
                  }}
                >
                  <span className="palette-item-title">Print / Save as PDF…</span>
                </Command.Item>
              </>
            )}
          </Command.Group>
          </Command.List>
        </Command>
      </div>
    </div>
  );
}