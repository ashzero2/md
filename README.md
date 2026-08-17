# vault

A local-first markdown knowledge base for macOS. Obsidian-style notes
(wikilinks, tags, backlinks, full-text search) without the Obsidian bloat:
low memory, beautiful UI, fast at scale.

> **Source of truth: [docs/adr.md](docs/adr.md)** — the single Architecture
> Decision Record. Read it before implementing; keep it in sync when
> decisions change.

## What it is (v1)

- A folder of plain `.md` files is the vault — your notes are yours, readable
  by any tool, git-versionable, externally editable.
- A SQLite index (in app data) makes search/backlinks/links instant and is
  fully rebuildable from files.
- Curated features only: edit/view markdown, file tree, full-text search +
  quick switcher, tags, wikilinks, backlinks, markdown extensions (GFM,
  tables, task lists, math, callouts). No plugin system. No graph view. No
  AI. No mobile (yet).

## Stack (see ADR-0001)

- **Tauri 2** (Rust backend, macOS WebView) — ~30–50MB idle RAM
- **React + TypeScript + Vite** frontend
- **CodeMirror 6** edit mode · **react-markdown/remark** view mode
- **rusqlite + FTS5** index and search

## Layout

```
src/              React frontend
src-tauri/        Rust backend (indexing, watcher, search, IPC)
docs/adr.md       Architecture Decision Record (source of truth)
```

## Development

(TBD once the scaffold exists.)
