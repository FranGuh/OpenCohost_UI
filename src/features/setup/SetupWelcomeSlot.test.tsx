import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { server } from "../../test/server.js";
import { API_BASE_URL, defaultSetupState } from "../../test/handlers.js";
import { useWelcomeStore } from "../../store/welcomeStore.js";
import type { SetupStateResponse, SetupStatus } from "../../api/setup.js";
import { ToastProvider } from "../../ui/Toast.js";
import { SetupWelcomeSlot } from "./SetupWelcomeSlot.js";

// The slot's job is wiring; the flow itself is covered by SetupFlow.test.tsx.
vi.mock("./SetupFlow.js", () => ({
  SetupFlow: ({
    variant,
    onClose,
    onComplete,
    checkpoint,
    checkpointReset
  }: {
    variant: string;
    onClose(): void;
    onComplete(): void;
    checkpoint?: { step: string } | null;
    checkpointReset?: boolean;
  }) => (
    <div
      role="dialog"
      aria-label={`setup-${variant}`}
      data-checkpoint={checkpoint?.step ?? "none"}
      data-reset={String(Boolean(checkpointReset))}
    >
      <button type="button" onClick={onClose}>stub-close</button>
      <button type="button" onClick={onComplete}>stub-complete</button>
    </div>
  )
}));

function serveState(state: SetupStateResponse): SetupStatus[] {
  const puts: SetupStatus[] = [];
  server.use(
    http.get(`${API_BASE_URL}/api/setup/state`, () => HttpResponse.json(state)),
    http.put(`${API_BASE_URL}/api/setup/state`, async ({ request }) => {
      const { status } = (await request.json()) as { status: SetupStatus };
      puts.push(status);
      return HttpResponse.json({ ...state, status, show_on_start: false });
    })
  );
  return puts;
}

function renderSlot() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <SetupWelcomeSlot />
    </QueryClientProvider>
  );
}

const pending: SetupStateResponse = { status: "pending", engine_ready: false, engine: null, show_on_start: true };

beforeEach(() => {
  window.localStorage.clear();
  useWelcomeStore.setState({ dismissed: false });
});

describe("SetupWelcomeSlot", () => {
  it("opens the modal flow when the backend says show_on_start, and PUTs skipped on close", async () => {
    const puts = serveState(pending);
    renderSlot();
    fireEvent.click(await screen.findByRole("button", { name: "stub-close" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await waitFor(() => expect(puts).toEqual(["skipped"]));
  });

  it("renders the flow as a modal and PUTs completed when finished", async () => {
    const puts = serveState(pending);
    renderSlot();
    expect(await screen.findByRole("dialog", { name: "setup-modal" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "stub-complete" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await waitFor(() => expect(puts).toEqual(["completed"]));
  });

  it("stays closed when show_on_start is false, even with a fresh localStorage", async () => {
    serveState(defaultSetupState);
    renderSlot();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("reopens from the 'show welcome' action and does not downgrade a completed setup on close", async () => {
    const puts = serveState(defaultSetupState);
    renderSlot();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    act(() => useWelcomeStore.getState().restore());
    fireEvent.click(screen.getByRole("button", { name: "stub-close" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(puts).toEqual([]);

    act(() => useWelcomeStore.getState().restore());
    expect(screen.getByRole("dialog", { name: "setup-modal" })).toBeInTheDocument();
  });

  it("falls back to the localStorage welcome card when the setup route fails", async () => {
    server.use(http.get(`${API_BASE_URL}/api/setup/state`, () => new HttpResponse(null, { status: 404 })));
    renderSlot();
    expect(await screen.findByRole("dialog", { name: "Conoce a Kira" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Omitir" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(window.localStorage.getItem("oc-welcome-dismissed-v1")).toBe("true");
  });
});

describe("SetupWelcomeSlot — checkpoints (S10)", () => {
  const saved = { version: 1, step: "voice", answers: {}, updated_at: "2026-11-12T10:00:00+00:00" };

  it("hands the saved progress of an unfinished setup to the flow", async () => {
    serveState({ ...pending, checkpoint: saved as never });
    renderSlot();
    expect(await screen.findByRole("dialog", { name: "setup-modal" })).toHaveAttribute("data-checkpoint", "voice");
  });

  it("tells the flow when a bad checkpoint was discarded", async () => {
    serveState({ ...pending, checkpoint: null, checkpoint_reset: "corrupt" });
    renderSlot();
    const dialog = await screen.findByRole("dialog", { name: "setup-modal" });
    expect(dialog).toHaveAttribute("data-reset", "true");
    expect(dialog).toHaveAttribute("data-checkpoint", "none");
  });
});

describe("SetupWelcomeSlot — failed status write (S8)", () => {
  it("raises a toast when recording the close fails", async () => {
    server.use(
      http.get(`${API_BASE_URL}/api/setup/state`, () => HttpResponse.json(pending)),
      http.put(`${API_BASE_URL}/api/setup/state`, () => new HttpResponse(null, { status: 500 }))
    );
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <ToastProvider>
          <SetupWelcomeSlot />
        </ToastProvider>
      </QueryClientProvider>
    );
    fireEvent.click(await screen.findByRole("button", { name: "stub-close" }));
    expect(await screen.findByText(/No pude guardar que cerraste la configuración/)).toBeInTheDocument();
  });
});
