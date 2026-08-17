// Shared types mirrored from the Rust IPC surface (src-tauri/src/ipc.rs).

export interface VaultInfo {
  root: string;
  files: number;
}

export interface NoteMeta {
  path: string;
  title: string;
  tags: string[];
}

export interface NoteContent {
  path: string;
  title: string;
  content: string;
}

export interface SearchResult {
  path: string;
  title: string;
  snippet: string;
  score: number;
}