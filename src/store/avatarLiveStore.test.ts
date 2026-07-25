import { beforeEach, describe, expect, it, vi } from "vitest";
import { useAvatarLiveState } from "./avatarLiveStore.js";

beforeEach(() => useAvatarLiveState.setState({ speaking: false, lastEventTs: 0, listening: false, lastPttTs: 0 }));

describe("avatarLiveStore: speaking edge", () => {
  it("stamps lastEventTs on every setSpeaking write", () => {
    useAvatarLiveState.getState().setSpeaking(true);
    const first = useAvatarLiveState.getState();
    expect(first.speaking).toBe(true);
    expect(first.lastEventTs).toBeGreaterThan(0);
  });
});

describe("avatarLiveStore: PTT listening signal", () => {
  it("publishes listening with a fresh timestamp", () => {
    useAvatarLiveState.getState().setListening(true);
    const state = useAvatarLiveState.getState();
    expect(state.listening).toBe(true);
    expect(state.lastPttTs).toBeGreaterThan(0);
  });

  it("clears listening on release", () => {
    useAvatarLiveState.getState().setListening(true);
    useAvatarLiveState.getState().setListening(false);
    expect(useAvatarLiveState.getState().listening).toBe(false);
  });

  it("refreshes lastPttTs on every true write — a long hold must stay FRESH", () => {
    vi.useFakeTimers();
    try {
      useAvatarLiveState.getState().setListening(true);
      const first = useAvatarLiveState.getState().lastPttTs;
      vi.advanceTimersByTime(5000);
      // The 1Hz keepalive/poll heartbeat re-asserts listening; without this the
      // freshness guard in KiraCover would expire mid-hold.
      useAvatarLiveState.getState().setListening(true);
      expect(useAvatarLiveState.getState().lastPttTs).toBeGreaterThan(first);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does NOT notify subscribers on a redundant idle write (1Hz poll must not churn renders)", () => {
    const seen = vi.fn();
    const unsubscribe = useAvatarLiveState.subscribe(seen);
    // The server signal polls at 1Hz forever; while nothing is held, every tick
    // reports listening:false and must be a complete no-op.
    useAvatarLiveState.getState().setListening(false);
    useAvatarLiveState.getState().setListening(false);
    expect(seen).not.toHaveBeenCalled();
    unsubscribe();
  });
});
