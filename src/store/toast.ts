// Lightweight auto-dismissing toasts for transient feedback.

import { create } from "zustand";

export interface Toast {
  id: number;
  message: string;
  kind?: "ok" | "error";
}

let nextId = 1;

export const useToastStore = create<{
  toasts: Toast[];
  push: (message: string, kind?: "ok" | "error") => void;
  dismiss: (id: number) => void;
}>((set, get) => ({
  toasts: [],
  push: (message, kind) => {
    const id = nextId++;
    set((s) => ({ toasts: [...s.toasts, { id, message, kind }] }));
    setTimeout(() => get().dismiss(id), 2600);
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));
