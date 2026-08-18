// Typed wrappers over the Tauri IPC surface. Every command here has a
// matching #[tauri::command] in src-tauri/src/ipc.rs — keep them in sync.

import { invoke } from "@tauri-apps/api/core";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import type {
  Backlink,
  BrokenLink,
  FileNode,
  NoteContent,
  NoteMeta,
  OpResult,
  OrphanNote,
  RelatedNote,
  SearchResult,
  Settings,
  TagCount,
  VaultInfo,
} from "./types";

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

export function listTree(): Promise<FileNode[]> {
  return invoke<FileNode[]>("list_tree");
}

export function getNote(path: string): Promise<NoteContent> {
  return invoke<NoteContent>("get_note", { path });
}

export function searchNotes(query: string): Promise<SearchResult[]> {
  return invoke<SearchResult[]>("search", { q: query });
}

export function saveNote(path: string, content: string): Promise<void> {
  return invoke<void>("save_note", { path, content });
}

export function resolveLink(target: string): Promise<string | null> {
  return invoke<string | null>("resolve_link", { target });
}

export function quickSwitcher(query: string): Promise<NoteMeta[]> {
  return invoke<NoteMeta[]>("quick_switcher", { q: query });
}

export function createNote(title: string, folder?: string | null): Promise<NoteContent> {
  return invoke<NoteContent>("create_note", { title, folder: folder ?? null });
}

export function getSettings(): Promise<Settings> {
  return invoke<Settings>("get_settings");
}

export function saveSettings(settings: Settings): Promise<void> {
  return invoke<void>("save_settings", { settingsIn: settings });
}

export function renameNote(path: string, newTitle: string): Promise<OpResult> {
  return invoke<OpResult>("rename_note", { path, newTitle });
}

export function moveNote(path: string, newFolder: string): Promise<OpResult> {
  return invoke<OpResult>("move_note", { path, newFolder });
}

export function deleteNoteFile(path: string): Promise<void> {
  return invoke<void>("delete_note_file", { path });
}

export function revealNote(path: string): Promise<void> {
  return invoke<void>("reveal_note", { path });
}

export { writeText as copyText };

export function getBrokenLinks(): Promise<BrokenLink[]> {
  return invoke<BrokenLink[]>("broken_links");
}

export function getOrphanNotes(): Promise<OrphanNote[]> {
  return invoke<OrphanNote[]>("orphan_notes");
}

export function getRelatedNotes(path: string): Promise<RelatedNote[]> {
  return invoke<RelatedNote[]>("related_notes", { path });
}

export function rebuildIndex(): Promise<number> {
  return invoke<number>("rebuild_index");
}

export function listTags(): Promise<TagCount[]> {
  return invoke<TagCount[]>("tags_list");
}

export function filesByTag(tag: string): Promise<NoteMeta[]> {
  return invoke<NoteMeta[]>("files_by_tag", { tag });
}

export function getBacklinks(path: string): Promise<Backlink[]> {
  return invoke<Backlink[]>("backlinks", { path });
}