// Typed wrappers over the Tauri IPC surface. Every command here has a
// matching #[tauri::command] in src-tauri/src/ipc.rs — keep them in sync.

import { invoke } from "@tauri-apps/api/core";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import type { NoteContent, NoteMeta, SearchResult, VaultInfo } from "./types";

export function pickVaultFolder(): Promise<string | null> {
  return openDialog({
    directory: true,
    multiple: false,
    title: "Choose your vault folder",
  });
}

export function openVault(path: string): Promise<VaultInfo> {
  return invoke<VaultInfo>("open_vault", { path });
}

export function listFiles(): Promise<NoteMeta[]> {
  return invoke<NoteMeta[]>("list_files");
}

export function getNote(path: string): Promise<NoteContent> {
  return invoke<NoteContent>("get_note", { path });
}

export function searchNotes(query: string): Promise<SearchResult[]> {
  return invoke<SearchResult[]>("search", { q: query });
}