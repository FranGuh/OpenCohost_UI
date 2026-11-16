import { http, HttpResponse } from "msw";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import React from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useUiLocaleStore } from "../../i18n/locale.js";
import { server } from "../../test/server.js";
import { API_BASE_URL } from "../../test/handlers.js";
import { SelfKnowledgeCard } from "./SelfKnowledgeCard.js";

type State = {
  enabled: boolean;
  viewers: boolean;
  creator: string;
  repository: string;
  description: string;
  defaults: { creator: string; repository: string };
};

const BASE: State = {
  enabled: true,
  viewers: false,
  creator: "",
  repository: "",
  description: "",
  defaults: { creator: "Built-in creator", repository: "github.com/x/y" }
};

function renderCard() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(React.createElement(QueryClientProvider, { client: queryClient }, React.createElement(SelfKnowledgeCard)));
}

function serve(initial: State, opts: { putStatus?: number; putBody?: unknown } = {}) {
  const state = { data: initial, puts: [] as Record<string, unknown>[] };
  server.use(
    http.get(`${API_BASE_URL}/api/self-knowledge`, () => HttpResponse.json(state.data)),
    http.put(`${API_BASE_URL}/api/self-knowledge`, async ({ request }) => {
      const body = (await request.json()) as Record<string, unknown>;
      state.puts.push(body);
      if (opts.putStatus && opts.putStatus !== 200) {
        return HttpResponse.json(opts.putBody ?? {}, { status: opts.putStatus });
      }
      state.data = { ...state.data, ...body } as State;
      return HttpResponse.json(state.data);
    })
  );
  return state;
}

describe("SelfKnowledgeCard", () => {
  // Test default locale is es; assert on the en copy.
  beforeEach(() => useUiLocaleStore.setState({ locale: "en" }));
  afterEach(() => useUiLocaleStore.setState({ locale: "es" }));

  it("renders both toggles and the identity fields with built-in defaults as placeholders", async () => {
    serve(BASE);
    renderCard();
    expect(await screen.findByRole("switch", { name: "Let Kira answer about the app" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("switch", { name: "Also answer viewers" })).toHaveAttribute("aria-checked", "false");
    expect(screen.getByLabelText("Creator")).toHaveAttribute("placeholder", "Built-in creator");
    expect(screen.getByLabelText("Repository")).toHaveAttribute("placeholder", "github.com/x/y");
    expect(screen.getByLabelText("Description")).toBeInTheDocument();
    expect(screen.getByText(/never see the model, VRAM, settings or commands/)).toBeInTheDocument();
  });

  it("disables the viewers toggle while the master toggle is off", async () => {
    serve({ ...BASE, enabled: false });
    renderCard();
    expect(await screen.findByRole("switch", { name: "Also answer viewers" })).toBeDisabled();
  });

  it("toggling the master sends a partial PUT with only that key", async () => {
    const user = userEvent.setup();
    const state = serve(BASE);
    renderCard();
    await user.click(await screen.findByRole("switch", { name: "Let Kira answer about the app" }));
    await waitFor(() => expect(state.puts).toEqual([{ enabled: false }]));
    await waitFor(() =>
      expect(screen.getByRole("switch", { name: "Let Kira answer about the app" })).toHaveAttribute("aria-checked", "false")
    );
  });

  it("toggling viewers sends only viewers", async () => {
    const user = userEvent.setup();
    const state = serve(BASE);
    renderCard();
    await user.click(await screen.findByRole("switch", { name: "Also answer viewers" }));
    await waitFor(() => expect(state.puts).toEqual([{ viewers: true }]));
  });

  it("rolls back a toggle and shows an inline error when the save fails", async () => {
    const user = userEvent.setup();
    serve(BASE, { putStatus: 503 });
    renderCard();
    const sw = await screen.findByRole("switch", { name: "Also answer viewers" });
    await user.click(sw);
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not save the app facts. Try again.");
    await waitFor(() => expect(sw).toHaveAttribute("aria-checked", "false"));
  });

  it("saves only the changed identity fields and keeps Save disabled until edited", async () => {
    const user = userEvent.setup();
    const state = serve(BASE);
    renderCard();
    const save = await screen.findByRole("button", { name: "Save" });
    expect(save).toBeDisabled();
    await user.type(screen.getByLabelText("Creator"), "Tavo");
    expect(save).toBeEnabled();
    await user.click(save);
    await waitFor(() => expect(state.puts).toEqual([{ creator: "Tavo" }]));
    await waitFor(() => expect(screen.getByRole("button", { name: "Save" })).toBeDisabled());
    expect(screen.getByLabelText("Creator")).toHaveValue("Tavo");
  });

  it("shows a 422 inline next to the offending field", async () => {
    const user = userEvent.setup();
    serve(BASE, {
      putStatus: 422,
      putBody: { detail: "invalid_self_knowledge", errors: [{ field: "repository", code: "invalid" }] }
    });
    renderCard();
    await user.type(await screen.findByLabelText("Repository"), "ftp://nope");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("Enter an http(s) link without credentials.")).toBeInTheDocument();
    expect(screen.getByLabelText("Repository")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByLabelText("Repository")).toHaveValue("ftp://nope");
  });

  it("shows a non-blocking unavailable note on 404 without an alert or controls", async () => {
    server.use(http.get(`${API_BASE_URL}/api/self-knowledge`, () => new HttpResponse(null, { status: 404 })));
    renderCard();
    expect(await screen.findByText("Not available in this backend yet.")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByRole("switch")).toBeNull();
  });

  it("shows the unavailable note on a network error", async () => {
    server.use(http.get(`${API_BASE_URL}/api/self-knowledge`, () => HttpResponse.error()));
    renderCard();
    expect(await screen.findByText("Not available in this backend yet.")).toBeInTheDocument();
  });

  it("shows a load error alert on a server error", async () => {
    server.use(http.get(`${API_BASE_URL}/api/self-knowledge`, () => new HttpResponse(null, { status: 500 })));
    renderCard();
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not load the app facts.");
  });

  it("renders neutral Spanish copy", async () => {
    useUiLocaleStore.setState({ locale: "es" });
    serve(BASE);
    renderCard();
    expect(await screen.findByRole("switch", { name: "Permitir que Kira responda sobre la app" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Guardar" })).toBeInTheDocument();
  });
});
