import { http, HttpResponse } from "msw";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { server } from "../../test/server.js";
import { API_BASE_URL, defaultAvatarConfig, defaultStatus } from "../../test/handlers.js";
import { useAvatarImageVersion } from "../../store/avatarImageVersion.js";
import { useAvatarLiveState } from "../../store/avatarLiveStore.js";
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
      expect(img.src).toContain("avatar/image?state=idle");
    });
  });

  it("switches to the speaking avatar when is_speaking is true", async () => {
    server.use(
      http.get(`${API_BASE_URL}/api/status`, () => HttpResponse.json({ ...defaultStatus, is_speaking: true }))
    );
    renderCover();
    await waitFor(() => {
      const img = screen.getByRole("img", { name: /Avatar de Kira/ }) as HTMLImageElement;
      expect(img.src).toMatch(/avatar\/image\?state=speaking$/);
    });
  });

  it("prefers a FRESH live speaking edge over the idle status poll", async () => {
    // Status stays idle (default handler); a fresh live speaking edge must win.
    useAvatarLiveState.setState({ speaking: true, lastEventTs: Date.now() });
    renderCover();
    await waitFor(() => {
      const img = screen.getByRole("img", { name: /Avatar de Kira/ }) as HTMLImageElement;
      expect(img.src).toMatch(/avatar\/image\?state=speaking$/);
    });
  });

  it("ignores a STALE live speaking edge and falls back to the poll-derived state", async () => {
    useAvatarLiveState.setState({ speaking: true, lastEventTs: Date.now() - 10_000 });
    renderCover();
    await waitFor(() => {
      const img = screen.getByRole("img", { name: /Avatar de Kira/ }) as HTMLImageElement;
      expect(img.src).toContain("avatar/image?state=idle");
    });
  });
});

describe("KiraCover: co-host label (F4 — provider truth, runtime_findings_batch_20260731 1.3)", () => {
  beforeEach(() =>
    useAvatarLiveState.setState({ speaking: false, lastEventTs: 0, listening: false, lastPttTs: 0 })
  );

  it("shows 'co-host local' when transport is local and no fallback is active", async () => {
    server.use(
      http.get(`${API_BASE_URL}/api/status`, () =>
        HttpResponse.json({ ...defaultStatus, transport: "local", fallback_active: false })
      )
    );
    renderCover();
    await waitFor(() => expect(screen.getByText(/co-host local/)).toBeInTheDocument());
    expect(screen.queryByText(/fallback/)).not.toBeInTheDocument();
  });

  it("shows 'co-host cloud' when transport is cloud", async () => {
    server.use(
      http.get(`${API_BASE_URL}/api/status`, () =>
        HttpResponse.json({ ...defaultStatus, transport: "cloud", fallback_active: false })
      )
    );
    renderCover();
    await waitFor(() => expect(screen.getByText(/co-host cloud/)).toBeInTheDocument());
  });

  it("shows 'co-host local · fallback' while a cloud fallback is active", async () => {
    server.use(
      http.get(`${API_BASE_URL}/api/status`, () =>
        HttpResponse.json({ ...defaultStatus, transport: "local", fallback_active: true })
      )
    );
    renderCover();
    await waitFor(() => expect(screen.getByText(/co-host local · fallback/)).toBeInTheDocument());
  });
});

describe("KiraCover: session mode (F13, runtime_findings_batch_20260731 2.5)", () => {
  beforeEach(() =>
    useAvatarLiveState.setState({ speaking: false, lastEventTs: 0, listening: false, lastPttTs: 0 })
  );

  it("shows 'Agenda activa' when session_mode is 'agenda'", async () => {
    server.use(
      http.get(`${API_BASE_URL}/api/status`, () => HttpResponse.json({ ...defaultStatus, session_mode: "agenda" }))
    );
    renderCover();
    await waitFor(() => expect(screen.getByText(/Agenda activa/)).toBeInTheDocument());
  });

  it("shows 'Post-agenda' when session_mode is 'post-agenda'", async () => {
    server.use(
      http.get(`${API_BASE_URL}/api/status`, () =>
        HttpResponse.json({ ...defaultStatus, session_mode: "post-agenda" })
      )
    );
    renderCover();
    await waitFor(() => expect(screen.getByText(/Post-agenda/)).toBeInTheDocument());
  });

  it("shows 'Inactiva' when session_mode is 'inactiva'", async () => {
    server.use(
      http.get(`${API_BASE_URL}/api/status`, () => HttpResponse.json({ ...defaultStatus, session_mode: "inactiva" }))
    );
    renderCover();
    await waitFor(() => expect(screen.getByText(/Inactiva/)).toBeInTheDocument());
  });
});

describe("KiraCover: listening (defect B/C — the operator must SEE the mic is live)", () => {
  beforeEach(() =>
    useAvatarLiveState.setState({ speaking: false, lastEventTs: 0, listening: false, lastPttTs: 0 })
  );

  it("shows the listening avatar while a PTT hold is open, though the poll says idle", async () => {
    useAvatarLiveState.setState({ listening: true, lastPttTs: Date.now() });
    renderCover();
    await waitFor(() => expect(avatarSrc()).toContain("avatar/image?state=listening"));
  });

  it("gives listening precedence over a simultaneous speaking edge", async () => {
    useAvatarLiveState.setState({
      listening: true,
      lastPttTs: Date.now(),
      speaking: true,
      lastEventTs: Date.now()
    });
    renderCover();
    await waitFor(() => expect(avatarSrc()).toContain("avatar/image?state=listening"));
  });

  it("ignores a STALE hold stamp — a dead heartbeat must not pin the mic open", async () => {
    // 3 missed beats == the server's own keepalive guillotine, so the session is
    // already gone by then.
    useAvatarLiveState.setState({ listening: true, lastPttTs: Date.now() - 10_000 });
    renderCover();
    await waitFor(() => expect(avatarSrc()).toContain("avatar/image?state=idle"));
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

  it("dozes off after the CTK idle window", async () => {
    renderCover();
    await settle();
    expect(avatarSrc()).toContain("avatar/image?state=idle");

    await act(() => vi.advanceTimersByTimeAsync(SLEEP_AFTER_IDLE_MS));
    expect(avatarSrc()).toContain("avatar/image?state=sleeping");
    // The label half of this ("dormida", the local doze, vs the backend's "en
    // espera") moved to kiraState.test.ts:106/114 when KiraCover's own status
    // badge was removed as a duplicate of AvatarCard's — the distinction is a
    // property of resolveAvatar(), so it is pinned at the logic layer, not here.
  });

  it("does NOT doze one tick before the window elapses", async () => {
    renderCover();
    await settle();
    await act(() => vi.advanceTimersByTimeAsync(SLEEP_AFTER_IDLE_MS - 1000));
    expect(avatarSrc()).toContain("avatar/image?state=idle");
  });

  it("wakes up and restarts the countdown on activity", async () => {
    renderCover();
    await settle();
    await act(() => vi.advanceTimersByTimeAsync(SLEEP_AFTER_IDLE_MS - 1000));
    expect(avatarSrc()).toContain("avatar/image?state=idle");

    // Kira spoke: that is activity, and it must reset the countdown.
    await act(async () => {
      useAvatarLiveState.getState().setSpeaking(true);
      useAvatarLiveState.getState().setSpeaking(false);
      await vi.advanceTimersByTimeAsync(0);
    });

    await act(() => vi.advanceTimersByTimeAsync(SLEEP_AFTER_IDLE_MS - 1000));
    expect(avatarSrc()).toContain("avatar/image?state=idle"); // would already be asleep without the reset
    await act(() => vi.advanceTimersByTimeAsync(2000));
    expect(avatarSrc()).toContain("avatar/image?state=sleeping");
  });

  it("wakes up the instant a PTT hold starts, mid-doze", async () => {
    renderCover();
    await settle();
    await act(() => vi.advanceTimersByTimeAsync(SLEEP_AFTER_IDLE_MS));
    expect(avatarSrc()).toContain("avatar/image?state=sleeping");

    await act(async () => {
      useAvatarLiveState.getState().setListening(true);
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(avatarSrc()).toContain("avatar/image?state=listening");
  });

  it("never dozes while the pipeline is busy", async () => {
    server.use(
      http.get(`${API_BASE_URL}/api/status`, () => HttpResponse.json({ ...defaultStatus, is_processing: true }))
    );
    renderCover();
    await settle();
    await act(() => vi.advanceTimersByTimeAsync(SLEEP_AFTER_IDLE_MS * 2));
    expect(avatarSrc()).toContain("avatar/image?state=thinking");
  });

  it("shows the sleeping avatar when the backend engine is not ready", async () => {
    server.use(
      http.get(`${API_BASE_URL}/api/status`, () => HttpResponse.json({ ...defaultStatus, is_ready: false }))
    );
    renderCover();
    await settle();
    expect(avatarSrc()).toContain("avatar/image?state=sleeping");
    // Same image as the local doze above, deliberately — the two are told apart
    // by label, and that assertion lives in kiraState.test.ts:106/114.
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
    expect(avatarSrc()).toMatch(/avatar\/image\?state=speaking$/);

    await act(() => vi.advanceTimersByTimeAsync(SPEAKING_ALT_MS));
    expect(avatarSrc()).toContain("avatar/image?state=speaking_alt");

    await act(() => vi.advanceTimersByTimeAsync(SPEAKING_ALT_MS));
    expect(avatarSrc()).toMatch(/avatar\/image\?state=speaking$/);

    server.use(http.get(`${API_BASE_URL}/api/status`, () => HttpResponse.json(defaultStatus)));
    await act(() => vi.advanceTimersByTimeAsync(2000)); // next status poll
    await act(() => vi.advanceTimersByTimeAsync(SPEAKING_ALT_MS * 3));
    expect(avatarSrc()).toContain("avatar/image?state=idle"); // alternation stopped dead
  });
});

describe("KiraCover: uploaded art with static fallback (tauri_avatar_upload_20260911)", () => {
  beforeEach(() => {
    useAvatarLiveState.setState({ speaking: false, lastEventTs: 0, listening: false, lastPttTs: 0 });
    useAvatarImageVersion.setState({ versions: {} });
  });

  it("paints static art when the state has no upload configured", async () => {
    server.use(
      http.get(`${API_BASE_URL}/api/avatar/config`, () =>
        HttpResponse.json({ ...defaultAvatarConfig, state_images: {} })
      )
    );
    renderCover();
    await waitFor(() => expect(avatarSrc()).toContain("/avatar/idle.png"));
  });

  it("falls back custom -> static -> kira-error on consecutive image errors", async () => {
    renderCover();
    await waitFor(() => expect(avatarSrc()).toContain("avatar/image?state=idle"));
    fireEvent.error(screen.getByRole("img", { name: /Avatar de Kira/ }));
    await waitFor(() => expect(avatarSrc()).toContain("/avatar/idle.png"));
    fireEvent.error(screen.getByRole("img", { name: /Avatar de Kira/ }));
    await waitFor(() => expect(avatarSrc()).toContain("/kira-error.png"));
  });

  it("repaints the served image after a same-state re-upload (version busting)", async () => {
    renderCover();
    await waitFor(() => expect(avatarSrc()).toContain("avatar/image?state=idle"));
    // The re-uploaded bytes live at the identical URL string — only the
    // bumped version makes the cover re-request and leave a parked fallback.
    fireEvent.error(screen.getByRole("img", { name: /Avatar de Kira/ }));
    await waitFor(() => expect(avatarSrc()).toContain("/avatar/idle.png"));
    act(() => useAvatarImageVersion.getState().bump("idle"));
    await waitFor(() => expect(avatarSrc()).toContain("avatar/image?state=idle&v=1"));
  });
});
