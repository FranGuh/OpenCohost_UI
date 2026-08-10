import { http, HttpResponse } from "msw";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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
  it("layers Welcome as a modal without replacing Kira and persists explicit dismissal", () => {
    renderStage();

    expect(screen.getByRole("dialog", { name: "Conocé a Kira" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Kira" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Omitir" }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(window.localStorage.getItem("oc-welcome-dismissed-v1")).toBe("true");
    expect(screen.getByRole("heading", { name: "Kira" })).toBeInTheDocument();
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
