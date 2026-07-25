import { http, HttpResponse } from "msw";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { server } from "../test/server.js";
import { API_BASE_URL, defaultStatus } from "../test/handlers.js";
import { useAvatarLiveState } from "../store/avatarLiveStore.js";
import { KiraCover, SLEEP_AFTER_IDLE_MS, SPEAKING_ALT_MS } from "./KiraCover.js";

function renderCover() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    React.createElement(QueryClientProvider, { client: queryClient }, React.createElement(KiraCover))
  );
}

function avatarSrc(): string {
  return (screen.getByRole("img", { name: /Avatar de Kira/ }) as HTMLImageElement).src;
}

describe("KiraCover", () => {
  beforeEach(() =>
    useAvatarLiveState.setState({ speaking: false, lastEventTs: 0, listening: false, lastPttTs: 0 })
  );

  it("renders the idle avatar by default (live status wiring)", async () => {
    renderCover();
    await waitFor(() => {
      const img = screen.getByRole("img", { name: /Avatar de Kira/ }) as HTMLImageElement;
      expect(img.src).toContain("/avatar/idle.png");
    });
  });

  it("switches to the speaking avatar when is_speaking is true", async () => {
    server.use(
      http.get(`${API_BASE_URL}/api/status`, () => HttpResponse.json({ ...defaultStatus, is_speaking: true }))
    );
    renderCover();
    await waitFor(() => {
      const img = screen.getByRole("img", { name: /Avatar de Kira/ }) as HTMLImageElement;
      expect(img.src).toContain("/avatar/speaking.png");
    });
  });

  it("prefers a FRESH live speaking edge over the idle status poll", async () => {
    // Status stays idle (default handler); a fresh live speaking edge must win.
    useAvatarLiveState.setState({ speaking: true, lastEventTs: Date.now() });
    renderCover();
    await waitFor(() => {
      const img = screen.getByRole("img", { name: /Avatar de Kira/ }) as HTMLImageElement;
      expect(img.src).toContain("/avatar/speaking.png");
    });
  });

  it("ignores a STALE live speaking edge and falls back to the poll-derived state", async () => {
    useAvatarLiveState.setState({ speaking: true, lastEventTs: Date.now() - 10_000 });
    renderCover();
    await waitFor(() => {
      const img = screen.getByRole("img", { name: /Avatar de Kira/ }) as HTMLImageElement;
      expect(img.src).toContain("/avatar/idle.png");
    });
  });
});

describe("KiraCover: listening (defect B/C — the operator must SEE the mic is live)", () => {
  beforeEach(() =>
    useAvatarLiveState.setState({ speaking: false, lastEventTs: 0, listening: false, lastPttTs: 0 })
  );

  it("shows the listening avatar while a PTT hold is open, though the poll says idle", async () => {
    useAvatarLiveState.setState({ listening: true, lastPttTs: Date.now() });
    renderCover();
    await waitFor(() => expect(avatarSrc()).toContain("/avatar/listening.png"));
    expect(screen.getByText("escuchando")).toBeTruthy();
  });

  it("gives listening precedence over a simultaneous speaking edge", async () => {
    useAvatarLiveState.setState({
      listening: true,
      lastPttTs: Date.now(),
      speaking: true,
      lastEventTs: Date.now()
    });
    renderCover();
    await waitFor(() => expect(avatarSrc()).toContain("/avatar/listening.png"));
  });

  it("ignores a STALE hold stamp — a dead heartbeat must not pin the mic open", async () => {
    // 3 missed beats == the server's own keepalive guillotine, so the session is
    // already gone by then.
    useAvatarLiveState.setState({ listening: true, lastPttTs: Date.now() - 10_000 });
    renderCover();
    await waitFor(() => expect(avatarSrc()).toContain("/avatar/idle.png"));
  });
});

describe("KiraCover: local inactivity doze (defect A — CTK parity)", () => {
  beforeEach(() => {
    useAvatarLiveState.setState({ speaking: false, lastEventTs: 0, listening: false, lastPttTs: 0 });
    vi.useFakeTimers();
  });
  afterEach(() => vi.useRealTimers());

  /** Settles the status poll so the derived state is a real "idle". */
  async function settle() {
    await act(() => vi.advanceTimersByTimeAsync(0));
  }

  it("dozes off after the CTK idle window and says so with its OWN label", async () => {
    renderCover();
    await settle();
    expect(avatarSrc()).toContain("/avatar/idle.png");

    await act(() => vi.advanceTimersByTimeAsync(SLEEP_AFTER_IDLE_MS));
    expect(avatarSrc()).toContain("/avatar/sleeping.png");
    // NOT the backend's "en espera" (= engine not warmed up) — a different fact.
    expect(screen.getByText("dormida")).toBeTruthy();
  });

  it("does NOT doze one tick before the window elapses", async () => {
    renderCover();
    await settle();
    await act(() => vi.advanceTimersByTimeAsync(SLEEP_AFTER_IDLE_MS - 1000));
    expect(avatarSrc()).toContain("/avatar/idle.png");
  });

  it("wakes up and restarts the countdown on activity", async () => {
    renderCover();
    await settle();
    await act(() => vi.advanceTimersByTimeAsync(SLEEP_AFTER_IDLE_MS - 1000));
    expect(avatarSrc()).toContain("/avatar/idle.png");

    // Kira spoke: that is activity, and it must reset the countdown.
    await act(async () => {
      useAvatarLiveState.getState().setSpeaking(true);
      useAvatarLiveState.getState().setSpeaking(false);
      await vi.advanceTimersByTimeAsync(0);
    });

    await act(() => vi.advanceTimersByTimeAsync(SLEEP_AFTER_IDLE_MS - 1000));
    expect(avatarSrc()).toContain("/avatar/idle.png"); // would already be asleep without the reset
    await act(() => vi.advanceTimersByTimeAsync(2000));
    expect(avatarSrc()).toContain("/avatar/sleeping.png");
  });

  it("wakes up the instant a PTT hold starts, mid-doze", async () => {
    renderCover();
    await settle();
    await act(() => vi.advanceTimersByTimeAsync(SLEEP_AFTER_IDLE_MS));
    expect(avatarSrc()).toContain("/avatar/sleeping.png");

    await act(async () => {
      useAvatarLiveState.getState().setListening(true);
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(avatarSrc()).toContain("/avatar/listening.png");
  });

  it("never dozes while the pipeline is busy", async () => {
    server.use(
      http.get(`${API_BASE_URL}/api/status`, () => HttpResponse.json({ ...defaultStatus, is_processing: true }))
    );
    renderCover();
    await settle();
    await act(() => vi.advanceTimersByTimeAsync(SLEEP_AFTER_IDLE_MS * 2));
    expect(avatarSrc()).toContain("/avatar/thinking.png");
  });

  it("keeps the backend's sleeping (engine not ready) on its own label, never the doze copy", async () => {
    server.use(
      http.get(`${API_BASE_URL}/api/status`, () => HttpResponse.json({ ...defaultStatus, is_ready: false }))
    );
    renderCover();
    await settle();
    expect(avatarSrc()).toContain("/avatar/sleeping.png");
    expect(screen.getByText("en espera")).toBeTruthy();
  });
});

describe("KiraCover: speaking alternation (defect D — CTK parity, 700ms)", () => {
  beforeEach(() => {
    useAvatarLiveState.setState({ speaking: false, lastEventTs: 0, listening: false, lastPttTs: 0 });
    vi.useFakeTimers();
  });
  afterEach(() => vi.useRealTimers());

  it("alternates speaking <-> speaking_alt while she talks, and stops when she is done", async () => {
    server.use(
      http.get(`${API_BASE_URL}/api/status`, () => HttpResponse.json({ ...defaultStatus, is_speaking: true }))
    );
    renderCover();
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(avatarSrc()).toContain("/avatar/speaking.png");

    await act(() => vi.advanceTimersByTimeAsync(SPEAKING_ALT_MS));
    expect(avatarSrc()).toContain("/avatar/speaking_alt.png");

    await act(() => vi.advanceTimersByTimeAsync(SPEAKING_ALT_MS));
    expect(avatarSrc()).toContain("/avatar/speaking.png");

    server.use(http.get(`${API_BASE_URL}/api/status`, () => HttpResponse.json(defaultStatus)));
    await act(() => vi.advanceTimersByTimeAsync(2000)); // next status poll
    await act(() => vi.advanceTimersByTimeAsync(SPEAKING_ALT_MS * 3));
    expect(avatarSrc()).toContain("/avatar/idle.png"); // alternation stopped dead
  });
});
