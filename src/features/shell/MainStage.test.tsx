import { http, HttpResponse } from "msw";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { beforeEach, describe, expect, it } from "vitest";
import { server } from "../../test/server.js";
import { API_BASE_URL, defaultStatus } from "../../test/handlers.js";
import { useWelcomeStore } from "../../store/welcomeStore.js";
import { MainStage } from "./MainStage.js";

beforeEach(() => {
  window.localStorage.clear();
  useWelcomeStore.setState({ dismissed: false });
});

function renderStage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    React.createElement(QueryClientProvider, { client: queryClient }, React.createElement(MainStage, { activeSection: "experiencia" }))
  );
}

describe("MainStage — experiencia stage wired to GET /api/status", () => {
  it("layers the setup assistant over Kira when the backend asks for it, and records a skip on close", async () => {
    const puts: unknown[] = [];
    server.use(
      http.get(`${API_BASE_URL}/api/setup/state`, () =>
        HttpResponse.json({ status: "pending", engine_ready: false, engine: null, show_on_start: true })
      ),
      http.put(`${API_BASE_URL}/api/setup/state`, async ({ request }) => {
        puts.push(await request.json());
        return HttpResponse.json({ status: "skipped", engine_ready: false, engine: null, show_on_start: false });
      })
    );
    renderStage();

    const dialog = await screen.findByRole("dialog", { name: "Asistente de configuración" });
    // The stage underneath stays mounted (the VRM context must survive the modal).
    expect(screen.getByRole("main")).toContainElement(dialog);
    fireEvent.click(screen.getByRole("button", { name: "Cerrar asistente" }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await waitFor(() => expect(puts).toEqual([{ status: "skipped" }]));
  });

  it("does not open anything when setup is already done", async () => {
    renderStage();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 30));
    });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  // Fallback path: the setup route is unreachable, so the old localStorage
  // welcome card keeps working. The "default" heading assertions belong to
  // KiraCover (owner's uncommitted work) and are unchanged.
  it("layers Welcome as a modal without replacing Kira and persists explicit dismissal", async () => {
    server.use(http.get(`${API_BASE_URL}/api/setup/state`, () => new HttpResponse(null, { status: 503 })));
    renderStage();

    expect(await screen.findByRole("dialog", { name: "Conoce a Kira" })).toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: "default" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Omitir" }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(window.localStorage.getItem("oc-welcome-dismissed-v1")).toBe("true");
    expect(await screen.findByRole("heading", { name: "default" })).toBeInTheDocument();
  });

  it("shows the real current_model from status, not a hardcoded 'Qwen 3 (1.7B)'", async () => {
    server.use(http.get(`${API_BASE_URL}/api/status`, () => HttpResponse.json({ ...defaultStatus, current_model: "llama3.2:3b" })));
    renderStage();

    await waitFor(() => expect(screen.getByText(/co-host local · llama3\.2:3b/)).toBeInTheDocument());
    expect(screen.queryByText(/Qwen 3 \(1\.7B\)/)).not.toBeInTheDocument();
  });

  it("falls back to a loading label before status resolves", () => {
    renderStage();
    expect(screen.getByText(/co-host local · cargando…/)).toBeInTheDocument();
  });

  // The two "Estado: <state>" now-line tests that used to live here were removed
  // with the badge they asserted on. MainStage has no state line of its own — it
  // renders <KiraCover />, whose status badge was a duplicate of AvatarCard's and
  // was deliberately commented out (KiraCover.tsx:126-129). These tests reached
  // through the child to assert a label MainStage never owned, so they were
  // pinning someone else's markup. The live label is AvatarCard's; the state ->
  // label mapping is pinned in kiraState.test.ts.
});
