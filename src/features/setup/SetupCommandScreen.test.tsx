import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { describe, expect, it, vi } from "vitest";
import { server } from "../../test/server.js";
import { API_BASE_URL } from "../../test/handlers.js";
import { SetupCommandScreen } from "./SetupCommandScreen.js";
import { stashSetupSection } from "./setupCheckpoint.js";

vi.mock("./SetupFlow.js", () => ({
  SetupFlow: ({
    variant,
    resume,
    onClose,
    onComplete,
    checkpoint,
    section
  }: {
    variant: string;
    resume?: boolean;
    onClose(): void;
    onComplete(): void;
    checkpoint?: { step: string } | null;
    section?: { kind: string; step?: string } | null;
  }) => (
    <div
      data-variant={variant}
      data-resume={String(Boolean(resume))}
      data-checkpoint={checkpoint?.step ?? "none"}
      data-section={section ? section.step ?? section.kind : "none"}
    >
      <button type="button" onClick={onClose}>stub-close</button>
      <button type="button" onClick={onComplete}>stub-complete</button>
    </div>
  )
}));

function renderScreen(onClose = vi.fn()) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <SetupCommandScreen onClose={onClose} />
    </QueryClientProvider>
  );
  return onClose;
}

describe("SetupCommandScreen (/setup)", () => {
  it("mounts the flow as a panel", async () => {
    renderScreen();
    expect((await screen.findByText("stub-close")).parentElement).toHaveAttribute("data-variant", "panel");
  });

  it("starts on the summary when the setup was already completed", async () => {
    server.use(
      http.get(`${API_BASE_URL}/api/setup/state`, () =>
        HttpResponse.json({ status: "completed", engine_ready: true, engine: "local", show_on_start: false })
      )
    );
    renderScreen();
    await waitFor(() => expect(screen.getByText("stub-close").parentElement).toHaveAttribute("data-resume", "true"));
  });

  it("runs the full flow when the setup was never completed", async () => {
    server.use(
      http.get(`${API_BASE_URL}/api/setup/state`, () =>
        HttpResponse.json({ status: "pending", engine_ready: false, engine: null, show_on_start: true })
      )
    );
    renderScreen();
    await waitFor(() => expect(screen.getByText("stub-close").parentElement).toHaveAttribute("data-resume", "false"));
  });

  it("PUTs completed and closes the panel when the flow finishes", async () => {
    const puts: unknown[] = [];
    server.use(
      http.put(`${API_BASE_URL}/api/setup/state`, async ({ request }) => {
        puts.push(await request.json());
        return HttpResponse.json({ status: "completed", engine_ready: true, engine: "local", show_on_start: false });
      })
    );
    const onClose = renderScreen();
    fireEvent.click(await screen.findByRole("button", { name: "stub-complete" }));
    expect(onClose).toHaveBeenCalledOnce();
    await waitFor(() => expect(puts).toEqual([{ status: "completed" }]));
  });

  const saved = { version: 1, step: "voice", answers: {}, updated_at: "2026-11-12T10:00:00+00:00" };

  it("hands the saved progress of a skipped setup to the flow", async () => {
    server.use(
      http.get(`${API_BASE_URL}/api/setup/state`, () =>
        HttpResponse.json({ status: "skipped", engine_ready: false, engine: null, show_on_start: false, checkpoint: saved })
      )
    );
    renderScreen();
    await waitFor(() => expect(screen.getByText("stub-close").parentElement).toHaveAttribute("data-checkpoint", "voice"));
  });

  it("never offers saved progress on a completed setup", async () => {
    server.use(
      http.get(`${API_BASE_URL}/api/setup/state`, () =>
        HttpResponse.json({ status: "completed", engine_ready: true, engine: "local", show_on_start: false, checkpoint: saved })
      )
    );
    renderScreen();
    await waitFor(() => expect(screen.getByText("stub-close").parentElement).toHaveAttribute("data-resume", "true"));
    expect(screen.getByText("stub-close").parentElement).toHaveAttribute("data-checkpoint", "none");
  });

  it.each([
    ["voz", "voice"],
    ["brain", "engine"],
    ["banana", "unknown"],
    ["", "none"]
  ])("passes the section typed after /setup (%s)", async (typed, expected) => {
    stashSetupSection(typed);
    renderScreen();
    await waitFor(() => expect(screen.getByText("stub-close").parentElement).toHaveAttribute("data-section", expected));
  });

  it("uses a typed section only once", async () => {
    stashSetupSection("voz");
    renderScreen();
    await screen.findByText("stub-close");
    cleanup();
    renderScreen();
    await waitFor(() => expect(screen.getByText("stub-close").parentElement).toHaveAttribute("data-section", "none"));
  });

  it("closing does not change the setup status", async () => {
    const onClose = renderScreen();
    fireEvent.click(await screen.findByRole("button", { name: "stub-close" }));
    expect(onClose).toHaveBeenCalledOnce();
  });
});
