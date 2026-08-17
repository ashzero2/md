// Debounced full-text search state (sidebar search panel).

import { create } from "zustand";
import { searchNotes } from "../lib/ipc";
import type { SearchResult } from "../lib/types";

interface SearchState {
  query: string;
  results: SearchResult[];
  loading: boolean;
  active: boolean;
  setQuery: (q: string) => void;
  clear: () => void;
  open: () => void;
  close: () => void;
}

let timer: ReturnType<typeof setTimeout> | null = null;

export const useSearchStore = create<SearchState>((set) => ({
  query: "",
  results: [],
  loading: false,
  active: false,
  setQuery: (query) => {
    set({ query });
    if (timer) clearTimeout(timer);
    if (!query.trim()) {
      set({ results: [], loading: false });
      return;
    }
    set({ loading: true, active: true });
    timer = setTimeout(() => {
      searchNotes(query)
        .then((results) => set({ results, loading: false }))
        .catch(() => set({ results: [], loading: false }));
    }, 150);
  },
  clear: () => {
    if (timer) clearTimeout(timer);
    set({ query: "", results: [], loading: false, active: false });
  },
  open: () => set({ active: true }),
  close: () => set({ active: false }),
}));