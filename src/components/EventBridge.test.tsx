import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render } from "@testing-library/react";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { server } from "../test/server.js";
import { defaultPttState, pttStateHandler } from "../test/handlers.js";
import { useAvatarLiveState } from "../store/avatarLiveStore.js";
import { EventBridge } from "./EventBridge.js";
import { ToastProvider } from "./ui/Toast.js";

/**
 * EventBridge is where the app-wide live signals are mounted. It renders
 * nothing, so the only thing worth pinning is that the signals are actually
 * wired — an unmounted signal fails completely silently.
 */
function renderBridge() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    React.createElement(
      QueryClientProvider,
      { client: queryClient },
      React.createElement(ToastProvider, null, React.createElement(EventBridge))
    )
  );
}

beforeEach(() => {
  vi.useFakeTimers();
  useAvatarLiveState.setState({ speaking: false, lastEventTs: 0, listening: false, lastPttTs: 0 });
});
afterEach(() => vi.useRealTimers());

describe("EventBridge", () => {
  it("mounts the PTT presence signal app-wide, so an EXTERNAL F10 hold reaches the avatar", async () => {
    // Nothing in the webview started this session — the F10 bridge did. Only a
    // signal mounted here (not inside a panel that may be unmounted) sees it.
    server.use(pttStateHandler({ ...defaultPttState, state: "listening", session_id: "f10-bridge" }));
    renderBridge();

    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(useAvatarLiveState.getState().listening).toBe(true);
  });
});
