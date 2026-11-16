import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  getDesktopState,
  setDesktopMode,
  desktopReady,
  reconcileDesktop,
  onDesktopState,
  resetClientRevisionForTesting,
  type DesktopSnapshot,
} from "./desktopClient.js";

const mockInvoke = vi.fn();
let eventHandler: ((event: { payload: DesktopSnapshot }) => void) | null = null;
const mockUnlisten = vi.fn();
const mockListen = vi.fn((event: string, handler: (event: { payload: DesktopSnapshot }) => void) => {
  eventHandler = handler;
  return Promise.resolve(mockUnlisten);
});

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: (event: string, handler: (event: { payload: DesktopSnapshot }) => void) =>
    mockListen(event, handler),
}));

describe("desktopClient IPC contract", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    eventHandler = null;
    resetClientRevisionForTesting();
  });

  it("calls desktop_state and returns snapshot", async () => {
    const snap: DesktopSnapshot = {
      enabled: false,
      visible: false,
      ready: false,
      model: "avatar.vrm",
      revision: 1,
      generation: 1,
      error: null,
    };
    mockInvoke.mockResolvedValueOnce(snap);

    const result = await getDesktopState();
    expect(mockInvoke).toHaveBeenCalledWith("desktop_state");
    expect(result).toEqual(snap);
  });

  it("calls desktop_set_mode with enabled and model", async () => {
    const snap: DesktopSnapshot = {
      enabled: true,
      visible: false,
      ready: false,
      model: "avatar.vrm",
      revision: 2,
      generation: 2,
      error: null,
    };
    mockInvoke.mockResolvedValueOnce(snap);

    const result = await setDesktopMode(true, "avatar.vrm");
    expect(mockInvoke).toHaveBeenCalledWith("desktop_set_mode", { enabled: true, model: "avatar.vrm" });
    expect(result).toEqual(snap);
  });

  it("calls desktop_ready with generation", async () => {
    const snap: DesktopSnapshot = {
      enabled: true,
      visible: true,
      ready: true,
      model: "avatar.vrm",
      revision: 3,
      generation: 2,
      error: null,
    };
    mockInvoke.mockResolvedValueOnce(snap);

    const result = await desktopReady(2);
    expect(mockInvoke).toHaveBeenCalledWith("desktop_ready", { generation: 2 });
    expect(result).toEqual(snap);
  });

  it("calls desktop_reconcile", async () => {
    const snap: DesktopSnapshot = {
      enabled: true,
      visible: true,
      ready: true,
      model: "avatar.vrm",
      revision: 4,
      generation: 2,
      error: null,
    };
    mockInvoke.mockResolvedValueOnce(snap);

    const result = await reconcileDesktop();
    expect(mockInvoke).toHaveBeenCalledWith("desktop_reconcile");
    expect(result).toEqual(snap);
  });

  it("discards stale snapshots with lower revisions and unlistens on cleanup", async () => {
    const snapshots: DesktopSnapshot[] = [];
    const unsubscribe = await onDesktopState((state) => {
      snapshots.push(state);
    });

    expect(mockListen).toHaveBeenCalledWith("desktop-state", expect.any(Function));
    expect(eventHandler).toBeDefined();

    // Emit revision 2
    eventHandler!({
      payload: {
        enabled: true,
        visible: false,
        ready: false,
        model: "m",
        revision: 2,
        generation: 1,
        error: null,
      },
    });

    // Emit stale revision 1 (must be discarded)
    eventHandler!({
      payload: {
        enabled: true,
        visible: true,
        ready: true,
        model: "m",
        revision: 1,
        generation: 1,
        error: null,
      },
    });

    // Emit newer revision 3
    eventHandler!({
      payload: {
        enabled: true,
        visible: true,
        ready: true,
        model: "m",
        revision: 3,
        generation: 1,
        error: null,
      },
    });

    expect(snapshots).toHaveLength(2);
    expect(snapshots[0].revision).toBe(2);
    expect(snapshots[1].revision).toBe(3);

    unsubscribe();
    expect(mockUnlisten).toHaveBeenCalledTimes(1);
  });
});
