// Link diagnostics: broken links (unresolved wikilinks) and orphan notes
// (nothing links to them). Broken links can be resolved by creating the note.

import { useEffect, useState } from "react";
import { getBrokenLinks, getOrphanNotes } from "../lib/ipc";
import type { BrokenLink, OrphanNote } from "../lib/types";
import { eventOpensInBackground, type OpenNoteOptions } from "../lib/open-intent";

export type DiagTab = "broken" | "orphan";

interface Props {
  open: boolean;
  tab: DiagTab;
  onClose: () => void;
  onOpenNote: (path: string, options?: OpenNoteOptions) => void;
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
  const [brokenTotal, setBrokenTotal] = useState(0);
  const [orphans, setOrphans] = useState<OrphanNote[]>([]);
  const [orphanTotal, setOrphanTotal] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);

  useEffect(() => {
    if (!open) return;
    setActiveTab(tab);
  }, [open, tab]);

  const loadBroken = () =>
    getBrokenLinks(0, 200).then((p) => {
      setBroken(p.items);
      setBrokenTotal(p.total);
    });
  const loadOrphans = () =>
    getOrphanNotes(0, 200).then((p) => {
      setOrphans(p.items);
      setOrphanTotal(p.total);
    });

  useEffect(() => {
    if (!open) return;
    setBroken([]);
    setBrokenTotal(0);
    setOrphans([]);
    setOrphanTotal(0);
    void loadBroken().catch(() => {});
    void loadOrphans().catch(() => {});
  }, [open]);

  const loadMore = async () => {
    setLoadingMore(true);
    try {
      if (activeTab === "broken") {
        const p = await getBrokenLinks(broken.length, 200);
        setBroken((prev) => [...prev, ...p.items]);
        setBrokenTotal(p.total);
      } else {
        const p = await getOrphanNotes(orphans.length, 200);
        setOrphans((prev) => [...prev, ...p.items]);
        setOrphanTotal(p.total);
      }
    } finally {
      setLoadingMore(false);
    }
  };

  if (!open) return null;

  const openOrphanNote = (event: React.MouseEvent<HTMLButtonElement>, path: string) => {
    const background = eventOpensInBackground(event);
    if (background) {
      event.preventDefault();
      onOpenNote(path, { background: true });
      return;
    }
    onClose();
    onOpenNote(path);
  };

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
            Broken links {brokenTotal > 0 && <span className="diag-count">{brokenTotal}</span>}
          </button>
          <button
            role="tab"
            aria-selected={activeTab === "orphan"}
            className={activeTab === "orphan" ? "active" : ""}
            onClick={() => setActiveTab("orphan")}
          >
            Orphans {orphanTotal > 0 && <span className="diag-count">{orphanTotal}</span>}
          </button>
        </div>

        <div className="diag-body">
          {activeTab === "broken" && (
            brokenTotal === 0 ? (
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
            orphanTotal === 0 ? (
              <p className="search-host-status">No orphan notes 🎉</p>
            ) : (
              <ul className="diag-list">
                {orphans.map((o) => (
                  <li key={o.path} className="diag-item">
                    <button
                      className="diag-item-main diag-orphan"
                      onClick={(e) => openOrphanNote(e, o.path)}
                      onAuxClick={(e) => {
                        if (e.button !== 1) return;
                        e.preventDefault();
                        onOpenNote(o.path, { background: true });
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

          {(activeTab === "broken" ? broken.length < brokenTotal : orphans.length < orphanTotal) && (
            <div className="diag-more">
              <button
                className="btn-quiet"
                onClick={() => void loadMore()}
                disabled={loadingMore}
              >
                {loadingMore
                  ? "Loading…"
                  : `Show more (${
                      activeTab === "broken" ? `${broken.length}/${brokenTotal}` : `${orphans.length}/${orphanTotal}`
                    })`}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
