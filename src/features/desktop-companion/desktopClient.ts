export type DesktopSnapshot = {
  enabled: boolean;
  visible: boolean;
  ready: boolean;
  model: string;
  revision: number;
  generation: number;
  error: string | null;
};

export const DEFAULT_DESKTOP_SNAPSHOT: DesktopSnapshot = {
  enabled: false,
  visible: false,
  ready: false,
  model: "",
  revision: 0,
  generation: 0,
  error: null,
};

let latestRevision = -1;

export function resetClientRevisionForTesting(): void {
  latestRevision = -1;
}

export async function getDesktopState(): Promise<DesktopSnapshot> {
  const { invoke } = await import("@tauri-apps/api/core");
  const state = await invoke<DesktopSnapshot>("desktop_state");
  if (state.revision >= latestRevision) {
    latestRevision = state.revision;
  }
  return state;
}

export async function setDesktopMode(enabled: boolean, model: string): Promise<DesktopSnapshot> {
  const { invoke } = await import("@tauri-apps/api/core");
  const state = await invoke<DesktopSnapshot>("desktop_set_mode", { enabled, model });
  if (state.revision >= latestRevision) {
    latestRevision = state.revision;
  }
  return state;
}

export async function desktopReady(generation: number): Promise<DesktopSnapshot> {
  const { invoke } = await import("@tauri-apps/api/core");
  const state = await invoke<DesktopSnapshot>("desktop_ready", { generation });
  if (state.revision >= latestRevision) {
    latestRevision = state.revision;
  }
  return state;
}

export async function reconcileDesktop(): Promise<DesktopSnapshot> {
  const { invoke } = await import("@tauri-apps/api/core");
  const state = await invoke<DesktopSnapshot>("desktop_reconcile");
  if (state.revision >= latestRevision) {
    latestRevision = state.revision;
  }
  return state;
}

export async function onDesktopState(fn: (state: DesktopSnapshot) => void): Promise<() => void> {
  const { listen } = await import("@tauri-apps/api/event");
  let lastSeenRevision = -1;
  const unlisten = await listen<DesktopSnapshot>("desktop-state", (event) => {
    if (event.payload.revision > lastSeenRevision) {
      lastSeenRevision = event.payload.revision;
      latestRevision = Math.max(latestRevision, event.payload.revision);
      fn(event.payload);
    }
  });
  return unlisten;
}
