// Link diagnostics: broken links (unresolved wikilinks) and orphan notes
// (nothing links to them). Broken links can be resolved by creating the note.

import { useEffect, useState } from "react";
import { getBrokenLinks, getOrphanNotes } from "../lib/ipc";
import type { BrokenLink, OrphanNote } from "../lib/types";

export type DiagTab = "broken" | "orphan";

interface Props {
  open: boolean;
  tab: DiagTab;
  onClose: () => void;
  onOpenNote: (path: string) => void;
  onCreateMissing: (target: string) => void;
  onStatus: (msg: string) => void;
}

export default function DiagnosticsPanel({
  open,
  tab,
  onClose,
  onOpenNote,
  onCreateMissing,
  onStatus,
}: Props) {
  const [activeTab, setActiveTab] = useState<DiagTab>(tab);
  const [broken, setBroken] = useState<BrokenLink[]>([]);
  const [orphans, setOrphans] = useState<OrphanNote[]>([]);

  useEffect(() => {
    if (!open) return;
    setActiveTab(tab);
  }, [open, tab]);

  useEffect(() => {
    if (!open) return;
    getBrokenLinks().then(setBroken).catch(() => {});
    getOrphanNotes().then(setOrphans).catch(() => {});
  }, [open]);

  if (!open) return null;

  return (
    <div className="search-overlay" onMouseDown={onClose}>
      <div className="diag-panel" onMouseDown={(e) => e.stopPropagation()}>
        <div className="search-host-input-wrap">
          <span className="diag-title">Links</span>
          <span className="search-host-hint">Esc to close</span>
        </div>

        <div className="diag-tabs" role="tablist">
          <button
            role="tab"
            aria-selected={activeTab === "broken"}
            className={activeTab === "broken" ? "active" : ""}
            onClick={() => setActiveTab("broken")}
          >
            Broken links {broken.length > 0 && <span className="diag-count">{broken.length}</span>}
          </button>
          <button
            role="tab"
            aria-selected={activeTab === "orphan"}
            className={activeTab === "orphan" ? "active" : ""}
            onClick={() => setActiveTab("orphan")}
          >
            Orphans {orphans.length > 0 && <span className="diag-count">{orphans.length}</span>}
          </button>
        </div>

        <div className="diag-body">
          {activeTab === "broken" && (
            broken.length === 0 ? (
              <p className="search-host-status">No broken links 🎉</p>
            ) : (
              <ul className="diag-list">
                {broken.map((b) => (
                  <li key={b.target} className="diag-item">
                    <div className="diag-item-main">
                      <span className="diag-target">[[{b.target}]]</span>
                      <button
                        className="btn-quiet diag-create"
                        onClick={() => {
                          onCreateMissing(b.target);
                          onStatus(`Created “${b.target}”`);
                        }}
                      >
                        Create note
                      </button>
                    </div>
                    <div className="diag-item-sub">
                      {b.count} link{b.count === 1 ? "" : "s"} ·{" "}
                      <span className="diag-sources">{b.sources.join(", ")}</span>
                    </div>
                  </li>
                ))}
              </ul>
            )
          )}

          {activeTab === "orphan" && (
            orphans.length === 0 ? (
              <p className="search-host-status">No orphan notes 🎉</p>
            ) : (
              <ul className="diag-list">
                {orphans.map((o) => (
                  <li key={o.path} className="diag-item">
                    <button
                      className="diag-item-main diag-orphan"
                      onClick={() => {
                        onClose();
                        onOpenNote(o.path);
                      }}
                    >
                      <span className="diag-target">{o.title}</span>
                    </button>
                    <div className="diag-item-sub">{o.path}</div>
                  </li>
                ))}
              </ul>
            )
          )}
        </div>
      </div>
    </div>
  );
}