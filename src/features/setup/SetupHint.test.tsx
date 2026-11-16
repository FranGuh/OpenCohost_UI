import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { afterEach, describe, expect, it, vi } from "vitest";
import { server } from "../../test/server.js";
import { API_BASE_URL } from "../../test/handlers.js";
import type { SetupStateResponse } from "../../api/setup.js";
import { SetupHint } from "./SetupHint.js";

function renderHint(state: SetupStateResponse | null) {
  server.use(
    http.get(`${API_BASE_URL}/api/setup/state`, () =>
      state ? HttpResponse.json(state) : new HttpResponse(null, { status: 500 })
    )
  );
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <SetupHint />
    </QueryClientProvider>
  );
}

describe("SetupHint", () => {
  it("shows one quiet hint when setup was skipped and no engine is usable", async () => {
    renderHint({ status: "skipped", engine_ready: false, engine: null, show_on_start: false });
    expect(await screen.findByText("Kira aún no tiene cerebro · escribe /setup")).toBeInTheDocument();
  });

  it.each([
    ["skipped with a working engine", { status: "skipped", engine_ready: true, engine: "local", show_on_start: false }],
    ["still pending", { status: "pending", engine_ready: false, engine: null, show_on_start: true }],
    ["completed", { status: "completed", engine_ready: true, engine: "cloud", show_on_start: false }]
  ] as const)("stays hidden when %s", async (_label, state) => {
    renderHint(state);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(screen.queryByText(/escribe \/setup/)).not.toBeInTheDocument();
  });

  it("stays hidden when the setup route is unavailable", async () => {
    renderHint(null);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(screen.queryByText(/escribe \/setup/)).not.toBeInTheDocument();
  });

  describe("polling while the hint shows", () => {
    afterEach(() => vi.useRealTimers());

    it("clears the hint once the engine becomes ready and stops polling", async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      let ready = false;
      let calls = 0;
      server.use(
        http.get(`${API_BASE_URL}/api/setup/state`, () => {
          calls += 1;
          return HttpResponse.json({ status: "skipped", engine_ready: ready, engine: ready ? "local" : null, show_on_start: false });
        })
      );
      const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      render(
        <QueryClientProvider client={queryClient}>
          <SetupHint />
        </QueryClientProvider>
      );
      expect(await screen.findByText(/escribe \/setup/)).toBeInTheDocument();

      ready = true;
      await vi.advanceTimersByTimeAsync(5_500);
      await waitFor(() => expect(screen.queryByText(/escribe \/setup/)).not.toBeInTheDocument());

      const settled = calls;
      await vi.advanceTimersByTimeAsync(20_000);
      expect(calls).toBe(settled);
    });
  });
});
