import { http, HttpResponse } from "msw";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { beforeEach, describe, expect, it } from "vitest";
import { server } from "../test/server.js";
import { API_BASE_URL, defaultStatus } from "../test/handlers.js";
import { useAvatarLiveState } from "../store/avatarLiveStore.js";
import { KiraCover } from "./KiraCover.js";

function renderCover() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    React.createElement(QueryClientProvider, { client: queryClient }, React.createElement(KiraCover))
  );
}

describe("KiraCover", () => {
  beforeEach(() => useAvatarLiveState.setState({ speaking: false, lastEventTs: 0 }));

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
