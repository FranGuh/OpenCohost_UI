import { http, HttpResponse } from "msw";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { describe, expect, it } from "vitest";
import { server } from "../test/server.js";
import { API_BASE_URL, defaultStatus } from "../test/handlers.js";
import { KiraCover } from "./KiraCover.js";

function renderCover() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    React.createElement(QueryClientProvider, { client: queryClient }, React.createElement(KiraCover))
  );
}

describe("KiraCover", () => {
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
});
