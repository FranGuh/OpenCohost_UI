import { http, HttpResponse } from "msw";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { describe, expect, it } from "vitest";
import { server } from "../test/server.js";
import { API_BASE_URL } from "../test/handlers.js";
import { EditorialCardsCard } from "./EditorialCardsCard.js";

function renderCard() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    React.createElement(QueryClientProvider, { client: queryClient }, React.createElement(EditorialCardsCard))
  );
}

function emptyCardsHandler() {
  return http.get(`${API_BASE_URL}/api/agent/cards`, () => HttpResponse.json({ cards: [] }));
}

async function fillRequiredFields() {
  fireEvent.change(await screen.findByLabelText("Tema"), { target: { value: "Tema de prueba" } });
  fireEvent.change(screen.getByLabelText("Resumen"), { target: { value: "Resumen de prueba" } });
  fireEvent.change(screen.getByLabelText("Postura del streamer"), { target: { value: "Mi postura" } });
}

function submitAndConfirm() {
  fireEvent.click(screen.getByRole("button", { name: "Guardar tarjeta" }));
  fireEvent.click(screen.getByRole("button", { name: "Confirmar" }));
}

describe("EditorialCardsCard form fields", () => {
  it("renders topic/summary/streamer_take/counterpoints/discussion_hooks/triggers fields", async () => {
    server.use(emptyCardsHandler());
    renderCard();

    expect(await screen.findByLabelText("Tema")).toBeInTheDocument();
    expect(screen.getByLabelText("Resumen")).toBeInTheDocument();
    expect(screen.getByLabelText("Postura del streamer")).toBeInTheDocument();
    expect(screen.getByLabelText("Contrapuntos (uno por línea)")).toBeInTheDocument();
    expect(screen.getByLabelText("Ganchos de discusión (uno por línea)")).toBeInTheDocument();
    expect(screen.getByLabelText("Disparadores (uno por línea)")).toBeInTheDocument();
  });
});

describe("EditorialCardsCard submit flow", () => {
  it("submit opens ConfirmFooter, confirming calls postEditorialCard with agent='operator' and expires_at=null", async () => {
    let capturedBody: Record<string, unknown> | undefined;
    server.use(emptyCardsHandler());
    server.use(
      http.post(`${API_BASE_URL}/api/agent/cards`, async ({ request }) => {
        capturedBody = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({ id: "card_a", topic_slug: "tema-de-prueba", status: "draft", demoted: false });
      })
    );
    renderCard();
    await fillRequiredFields();

    fireEvent.click(screen.getByRole("button", { name: "Guardar tarjeta" }));
    expect(capturedBody).toBeUndefined();
    expect(screen.getByText(/Vas a crear la tarjeta/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Confirmar" }));
    await waitFor(() => expect(capturedBody).toMatchObject({ agent: "operator", expires_at: null }));
  });

  it("splits one-item-per-line textareas into string arrays on submit", async () => {
    let capturedBody: Record<string, unknown> | undefined;
    server.use(emptyCardsHandler());
    server.use(
      http.post(`${API_BASE_URL}/api/agent/cards`, async ({ request }) => {
        capturedBody = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({ id: "card_a", topic_slug: "tema-de-prueba", status: "draft", demoted: false });
      })
    );
    renderCard();
    await fillRequiredFields();
    fireEvent.change(screen.getByLabelText("Contrapuntos (uno por línea)"), {
      target: { value: "uno\n  dos  \n\ntres" }
    });
    fireEvent.change(screen.getByLabelText("Ganchos de discusión (uno por línea)"), {
      target: { value: "hook1\nhook2" }
    });
    fireEvent.change(screen.getByLabelText("Disparadores (uno por línea)"), { target: { value: "trig1" } });

    submitAndConfirm();

    await waitFor(() => expect(capturedBody?.counterpoints).toEqual(["uno", "dos", "tres"]));
    expect(capturedBody?.discussion_hooks).toEqual(["hook1", "hook2"]);
    expect(capturedBody?.triggers).toEqual(["trig1"]);
  });

  it("pre-warns when a list line exceeds 240 characters, before submit", async () => {
    server.use(emptyCardsHandler());
    renderCard();
    const longLine = "x".repeat(241);
    fireEvent.change(await screen.findByLabelText("Contrapuntos (uno por línea)"), { target: { value: longLine } });

    expect(screen.getByText("Cada línea puede tener hasta 240 caracteres.")).toBeInTheDocument();
  });

  it("pre-warns when a list has more than 8 lines, before submit", async () => {
    server.use(emptyCardsHandler());
    renderCard();
    const nineLines = Array.from({ length: 9 }, (_, i) => `line ${i}`).join("\n");
    fireEvent.change(await screen.findByLabelText("Disparadores (uno por línea)"), { target: { value: nineLines } });

    expect(screen.getByText("Solo se guardan las primeras 8 líneas.")).toBeInTheDocument();
  });

  it("shows the demoted-notice copy when the response has demoted:true", async () => {
    server.use(emptyCardsHandler());
    server.use(
      http.post(`${API_BASE_URL}/api/agent/cards`, () =>
        HttpResponse.json({ id: "card_a", topic_slug: "tema-de-prueba", status: "draft", demoted: true })
      )
    );
    renderCard();
    await fillRequiredFields();
    submitAndConfirm();

    await waitFor(() =>
      expect(
        screen.getByText("Guardaste cambios: la tarjeta volvió a borrador. Armala de nuevo cuando quieras.")
      ).toBeInTheDocument()
    );
  });

  it("shows the created-notice copy when the response has demoted:false", async () => {
    server.use(emptyCardsHandler());
    server.use(
      http.post(`${API_BASE_URL}/api/agent/cards`, () =>
        HttpResponse.json({ id: "card_a", topic_slug: "tema-de-prueba", status: "draft", demoted: false })
      )
    );
    renderCard();
    await fillRequiredFields();
    submitAndConfirm();

    await waitFor(() =>
      expect(screen.getByText("Tarjeta guardada como borrador. Armala cuando quieras.")).toBeInTheDocument()
    );
  });
});

describe("EditorialCardsCard list", () => {
  function listWith(items: Array<Record<string, unknown>>) {
    return http.get(`${API_BASE_URL}/api/agent/cards`, () => HttpResponse.json({ cards: items }));
  }

  function card(overrides: Record<string, unknown>) {
    return {
      id: "card_x",
      topic: "Topic",
      topic_slug: "topic",
      status: "draft",
      origin: "operator",
      expires_at: null,
      updated_at: "2026-07-18T00:00:00+00:00",
      ...overrides
    };
  }

  it("list renders only draft and armed rows, not used/expired/disabled", async () => {
    server.use(
      listWith([
        card({ id: "c1", topic: "Draft topic", status: "draft" }),
        card({ id: "c2", topic: "Armed topic", status: "armed" }),
        card({ id: "c3", topic: "Used topic", status: "used" }),
        card({ id: "c4", topic: "Expired topic", status: "expired" }),
        card({ id: "c5", topic: "Disabled topic", status: "disabled" })
      ])
    );
    renderCard();

    await waitFor(() => expect(screen.getByText("Draft topic")).toBeInTheDocument());
    expect(screen.getByText("Armed topic")).toBeInTheDocument();
    expect(screen.queryByText("Used topic")).not.toBeInTheDocument();
    expect(screen.queryByText("Expired topic")).not.toBeInTheDocument();
    expect(screen.queryByText("Disabled topic")).not.toBeInTheDocument();
  });

  it("Armar button is shown only on draft rows", async () => {
    server.use(
      listWith([
        card({ id: "c1", topic: "Draft topic", status: "draft" }),
        card({ id: "c2", topic: "Armed topic", status: "armed" })
      ])
    );
    renderCard();

    await waitFor(() => expect(screen.getByText("Draft topic")).toBeInTheDocument());
    expect(screen.getAllByRole("button", { name: "Armar" })).toHaveLength(1);
  });

  it("clicking Armar calls armEditorialCard with the row's id", async () => {
    let capturedId: string | undefined;
    server.use(listWith([card({ id: "card_x", topic: "Draft topic", status: "draft" })]));
    server.use(
      http.post(`${API_BASE_URL}/api/agent/cards/:id/arm`, ({ params }) => {
        capturedId = String(params.id);
        return HttpResponse.json({ id: params.id, status: "armed" });
      })
    );
    renderCard();

    fireEvent.click(await screen.findByRole("button", { name: "Armar" }));
    await waitFor(() => expect(capturedId).toBe("card_x"));
  });

  it("shows the 409 arm copy: Esa tarjeta ya no se puede armar...", async () => {
    server.use(listWith([card({ id: "card_x", topic: "Draft topic", status: "draft" })]));
    server.use(
      http.post(`${API_BASE_URL}/api/agent/cards/:id/arm`, () =>
        HttpResponse.json({ detail: "card_not_armable" }, { status: 409 })
      )
    );
    renderCard();

    fireEvent.click(await screen.findByRole("button", { name: "Armar" }));
    await waitFor(() =>
      expect(screen.getByText("Esa tarjeta ya no se puede armar (vencida o ya usada).")).toBeInTheDocument()
    );
  });
});

describe("EditorialCardsCard error copy per HTTP status", () => {
  it("shows the 401 copy: No hay sesión de operador válida...", async () => {
    server.use(emptyCardsHandler());
    server.use(http.post(`${API_BASE_URL}/api/agent/cards`, () => HttpResponse.json({ detail: "unauthorized" }, { status: 401 })));
    renderCard();
    await fillRequiredFields();
    submitAndConfirm();

    await waitFor(() =>
      expect(screen.getByText("No hay sesión de operador válida. Reabrí la app.")).toBeInTheDocument()
    );
  });

  it("shows the 422 copy including the server detail", async () => {
    server.use(emptyCardsHandler());
    server.use(
      http.post(`${API_BASE_URL}/api/agent/cards`, () =>
        HttpResponse.json({ detail: "topic must not be empty" }, { status: 422 })
      )
    );
    renderCard();
    await fillRequiredFields();
    submitAndConfirm();

    await waitFor(() =>
      expect(
        screen.getByText(
          "El servidor rechazó la tarjeta: topic must not be empty. Acortá el texto o repartilo en los campos."
        )
      ).toBeInTheDocument()
    );
  });

  it("shows the 429 copy: Demasiadas operaciones seguidas...", async () => {
    server.use(emptyCardsHandler());
    server.use(http.post(`${API_BASE_URL}/api/agent/cards`, () => HttpResponse.json({ detail: "rate_limited" }, { status: 429 })));
    renderCard();
    await fillRequiredFields();
    submitAndConfirm();

    await waitFor(() =>
      expect(screen.getByText("Demasiadas operaciones seguidas. Esperá un minuto.")).toBeInTheDocument()
    );
  });

  it("shows the 503 copy: La base de tarjetas no responde...", async () => {
    server.use(emptyCardsHandler());
    server.use(
      http.post(`${API_BASE_URL}/api/agent/cards`, () =>
        HttpResponse.json({ detail: "editorial_cards_unavailable" }, { status: 503 })
      )
    );
    renderCard();
    await fillRequiredFields();
    submitAndConfirm();

    await waitFor(() =>
      expect(screen.getByText("La base de tarjetas no responde. Probá de nuevo en un rato.")).toBeInTheDocument()
    );
  });
});
