import { create } from "zustand";
import type { FramingMode } from "../features/avatar-vrm/domain/vrmLoader.js";

export const STAGE_ZOOM_STORAGE_KEY = "oc-main-avatar-zoom";
const LEGACY_ZOOM_STORAGE_KEY = "oc-desktop-companion-zoom";

function readFraming(): FramingMode {
  try {
    const saved = localStorage.getItem(STAGE_ZOOM_STORAGE_KEY) || localStorage.getItem(LEGACY_ZOOM_STORAGE_KEY);
    if (saved === "full" || saved === "half" || saved === "head") return saved;
  } catch {
    // Storage is best-effort; fall back to the default framing.
  }
  return "half";
}

export interface StageControlsState {
  /** Camera framing of the 3D stage (Cuerpo / Medio / Rostro). */
  framingMode: FramingMode;
  /** Sequential animation test ("Probar animaciones") running flag + position. */
  qaRunning: boolean;
  qaIndex: number;
  /** True while KiraCover renders the 3D VrmStage; gates the title bar controls. */
  stage3dMounted: boolean;
  setFramingMode(mode: FramingMode): void;
  startQa(): void;
  stopQa(): void;
  setQaIndex(index: number): void;
  setStage3dMounted(mounted: boolean): void;
}

/** The title bar controls and the stage (KiraCover) live in different subtrees,
 * so this store is their shared owner. */
export const useStageControlsStore = create<StageControlsState>((set) => ({
  framingMode: readFraming(),
  qaRunning: false,
  qaIndex: 0,
  stage3dMounted: false,
  setFramingMode: (mode) => {
    set({ framingMode: mode });
    try {
      localStorage.setItem(STAGE_ZOOM_STORAGE_KEY, mode);
    } catch {
      // best-effort persistence
    }
  },
  startQa: () => set({ qaRunning: true, qaIndex: 0 }),
  stopQa: () => set({ qaRunning: false }),
  setQaIndex: (index) => set({ qaIndex: index }),
  setStage3dMounted: (mounted) => set({ stage3dMounted: mounted })
}));
