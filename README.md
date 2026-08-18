# vault

A local-first markdown knowledge base for macOS. Obsidian-style notes —
wikilinks, tags, backlinks, full-text search — without the bloat: low memory,
fast at scale, and a calm, editorial UI.

> **Source of truth: [docs/adr.md](docs/adr.md)** — the Architecture Decision
> Record. Read it before implementing; keep it in sync when decisions change.
> Working design notes live in `docs/` (untracked).

## Features

- **Plain `.md` vault** — your notes are a folder of files you own: portable,
  git-versionable, editable by any tool. A SQLite index (in app data) is a
  fully rebuildable cache for speed.
- **Edit / Read** (`⌘E`) — CodeMirror 6 editor and a beautifully rendered
  markdown view, sharing one writing surface.
- **File tree** — folder navigation, right-click actions (rename · move ·
  delete · reveal in Finder · copy wikilink/markdown link), live re-sync on
  external edits.
- **Search** — full-screen full-text search (`⌘F`, SQLite FTS5, sub-10ms on
  10K files) and a quick switcher (`⌘P`) with fuzzy title matching and
  create-note flow.
- **Links** — `[[wikilinks]]` with in-editor autocomplete, click-to-navigate,
  backlinks + mentions with context snippets, a **Related** section (shared
  tags), and diagnostics: **broken links** (with "create missing note") and
  **orphan notes**, all from the command palette.
- **Tags & metadata** — tag sidebar with counts + filter, YAML frontmatter.
- **Markdown extensions** — GFM tables & task lists, KaTeX math, callouts
  (`> [!note]`), syntax-highlighted code.
- **Export** — current note as a self-contained HTML file, plus **Print /
  Save as PDF** through the browser print flow (with page-break control).
- **Live sync** — a file watcher reconciles external edits in ~1s; conflicts
  with unsaved changes prompt you rather than clobber.
- **Settings** (`⌘,`) — theme (system/light/dark), editor font/size/line
  numbers, reading font size/line width, autosave delay, new-note location,
  update-links-on-rename, reopen-last-vault, confirm-before-delete.
- **Deliberately not included**: plugin marketplace, graph view, canvas,
  dataview queries, cloud sync, AI assistant, mobile — per the app's thesis.

## Stack

- **Tauri 2** (Rust backend, macOS WebView) — ~16MB binary, low memory
- **React + TypeScript + Vite** frontend
- **CodeMirror 6** edit mode · **react-markdown/remark** view & HTML export
- **rusqlite + FTS5** index and search (BM25 ranking)
- Tests: Rust `cargo test` · Vitest + Testing Library for the frontend

## Layout

```
src/                React frontend
  components/       tree, editor, view, backlinks, palette, search, dialogs
  lib/              IPC wrappers, types, markdown pipeline, HTML export
  store/            zustand stores (editor, settings, search, toast)
  styles/           design tokens + prose typography
src-tauri/          Rust backend (scanning, parser, SQLite index, watcher,
                    file ops, link rewriting, IPC commands)
docs/adr.md         Architecture Decision Record (source of truth)
docs/plans/         implementation & gap plans
```

## Development

Prereqs: Rust toolchain + Xcode CLT, Node ≥ 22 (use `fnm use 24`), and the
npm registry that hosts our deps (`.npmrc` pins the official registry).

```bash
fnm use 24
npm install
npm run tauri dev      # dev loop (hot reload + Rust backend + native window)
npm run test           # frontend unit tests (Vitest)
cargo test             # Rust tests (in src-tauri/)
npm run build          # typecheck + bundle
npm run tauri build    # release .app + .dmg into src-tauri/target/release/bundle/
```

### Shortcuts

| Keys | Action |
|------|--------|
| `⌘E` | toggle Edit / Read |
| `⌘P` | quick switcher + command palette |
| `⌘F` | full-text search |
| `⌘,` | settings |
| `⌘O` | open / switch vault |
| `⌘Shift+L` | cycle theme (system → dark → light) |

Format: notes are plain `.md` (CommonMark + GFM); store only portable content
in the vault — app settings persist to app data, never inside the vault.
