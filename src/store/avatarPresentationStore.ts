import { create } from "zustand";

export type AvatarPresentationMode = "2d" | "3d";

const STORAGE_KEY = "oc-avatar-presentation";

interface StoredPresentation {
  mode?: AvatarPresentationMode;
  selectedModel?: string;
}

export function readStoredPresentation(): { mode: AvatarPresentationMode; selectedModel: string } {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { mode: "2d", selectedModel: "" };
    const parsed = JSON.parse(raw) as StoredPresentation;
    return {
      mode: parsed.mode === "3d" ? "3d" : "2d",
      selectedModel: typeof parsed.selectedModel === "string" ? parsed.selectedModel : ""
    };
  } catch {
    return { mode: "2d", selectedModel: "" };
  }
}

/** True once a presentation was ever saved: the user (or setup) already chose one. */
export function hasStoredPresentation(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_KEY) !== null;
  } catch {
    return false;
  }
}

export interface AvatarPresentationState {
  mode: AvatarPresentationMode;
  selectedModel: string;
  setMode(mode: AvatarPresentationMode): void;
  setSelectedModel(model: string): void;
}

export const useAvatarPresentationStore = create<AvatarPresentationState>((set, get) => {
  const initial = readStoredPresentation();
  return {
    mode: initial.mode,
    selectedModel: initial.selectedModel,
    setMode: (mode) => {
      set({ mode });
      try {
        window.localStorage.setItem(
          STORAGE_KEY,
          JSON.stringify({ mode, selectedModel: get().selectedModel })
        );
      } catch {
        // best-effort persistence
      }
    },
    setSelectedModel: (selectedModel) => {
      set({ selectedModel });
      try {
        window.localStorage.setItem(
          STORAGE_KEY,
          JSON.stringify({ mode: get().mode, selectedModel })
        );
      } catch {
        // best-effort persistence
      }
    }
  };
});
