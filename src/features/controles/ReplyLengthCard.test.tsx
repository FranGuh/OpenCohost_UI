import { http, HttpResponse } from "msw";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import React from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useUiLocaleStore } from "../../i18n/locale.js";
import { server } from "../../test/server.js";
import { API_BASE_URL } from "../../test/handlers.js";
import { ReplyLengthCard } from "./ReplyLengthCard.js";

function renderCard() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(React.createElement(QueryClientProvider, { client: queryClient }, React.createElement(ReplyLengthCard)));
}

function serve(initial: string, opts: { putStatus?: number; gate?: Promise<void> } = {}) {
  const state = { mode: initial, puts: [] as string[] };
  server.use(
    http.get(`${API_BASE_URL}/api/reply-length`, () => HttpResponse.json({ mode: state.mode })),
    http.put(`${API_BASE_URL}/api/reply-length`, async ({ request }) => {
      const body = (await request.json()) as { mode: string };
      state.puts.push(body.mode);
      if (opts.gate) await opts.gate;
      if (opts.putStatus && opts.putStatus !== 200) {
        return HttpResponse.json({ detail: "reply_length_write_failed" }, { status: opts.putStatus });
      }
      state.mode = body.mode;
      return HttpResponse.json({ mode: state.mode });
    })
  );
  return state;
}

describe("ReplyLengthCard", () => {
  // Test default locale is es; assert on the en copy unless stated.
  beforeEach(() => useUiLocaleStore.setState({ locale: "en" }));
  afterEach(() => useUiLocaleStore.setState({ locale: "es" }));

  it("shows a loading state, then the group with the server mode pressed", async () => {
    serve("long");
    renderCard();
    expect(screen.getByText("Loading...")).toBeInTheDocument();
    expect(await screen.findByRole("group", { name: "Reply length" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Reply length" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Long" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Auto" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getAllByRole("button").map((b) => b.textContent)).toEqual([
      "Auto",
      "Short",
      "Medium",
      "Long",
      "Very long"
    ]);
  });

  it("describes the selected option via aria-describedby and shows the profile override note", async () => {
    serve("short");
    renderCard();
    const group = await screen.findByRole("group", { name: "Reply length" });
    const hint = document.getElementById(group.getAttribute("aria-describedby") ?? "none");
    expect(hint).toHaveTextContent("1-2 sentences.");
    expect(screen.getByText(/profile has extended replies enabled/)).toBeInTheDocument();
  });

  it("saves immediately on change with a PUT and updates the hint", async () => {
    const user = userEvent.setup();
    const state = serve("auto");
    renderCard();
    await user.click(await screen.findByRole("button", { name: "Very long" }));
    await waitFor(() => expect(state.puts).toEqual(["very_long"]));
    await waitFor(() => expect(screen.getByRole("button", { name: "Very long" })).toHaveAttribute("aria-pressed", "true"));
    expect(screen.getByText(/No brevity limit/)).toBeInTheDocument();
  });

  it("updates optimistically while the save is in flight", async () => {
    const user = userEvent.setup();
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    serve("auto", { gate });
    renderCard();
    const medium = await screen.findByRole("button", { name: "Medium" });
    await user.click(medium);
    await waitFor(() => expect(medium).toHaveAttribute("aria-pressed", "true"));
    release();
  });

  it("rolls back and shows an inline error when the save fails", async () => {
    const user = userEvent.setup();
    serve("auto", { putStatus: 503 });
    renderCard();
    await user.click(await screen.findByRole("button", { name: "Short" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not save the reply length. Try again.");
    await waitFor(() => expect(screen.getByRole("button", { name: "Auto" })).toHaveAttribute("aria-pressed", "true"));
    expect(screen.getByRole("button", { name: "Short" })).toHaveAttribute("aria-pressed", "false");
  });

  it("shows an error and keeps the control disabled when the GET fails", async () => {
    server.use(http.get(`${API_BASE_URL}/api/reply-length`, () => new HttpResponse(null, { status: 500 })));
    renderCard();
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not load the reply length.");
    expect(screen.getByRole("group", { name: "Reply length" })).toBeInTheDocument();
    for (const b of screen.getAllByRole("button")) expect(b).toBeDisabled();
  });

  it("renders neutral Spanish copy", async () => {
    useUiLocaleStore.setState({ locale: "es" });
    serve("auto");
    renderCard();
    expect(await screen.findByRole("group", { name: "Longitud de respuesta" })).toBeInTheDocument();
    for (const name of ["Automática", "Corta", "Media", "Larga", "Muy larga"]) {
      expect(screen.getByRole("button", { name })).toBeInTheDocument();
    }
    expect(
      screen.getByText("Kira elige según lo que digas: corta para saludos, más larga si pides que explique.")
    ).toBeInTheDocument();
    expect(
      screen.getByText("Si el perfil tiene activadas las respuestas extendidas, se usan respuestas muy largas.")
    ).toBeInTheDocument();
  });
});
