import { http, HttpResponse } from "msw";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import React from "react";
import { beforeEach, describe, expect, it } from "vitest";
import { server } from "../../test/server.js";
import { API_BASE_URL } from "../../test/handlers.js";
import { ActiveCardEditor } from "./ActiveCardControls.js";
import { EditorialCardsCard } from "./EditorialCardsCard.js";

// Collapse state now persists to localStorage (oc-collapse-*); clear between
// tests so section open/closed order-dependence can't leak across cases.
beforeEach(() => {
  window.localStorage.clear();
});

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

describe("EditorialCardsCard collapsible sections + textarea sizing", () => {
  it("splits create/list into persisted SubCollapsibleSections", async () => {
    server.use(emptyCardsHandler());
    renderCard();

    const createHeader = await screen.findByRole("button", { name: /Crear tarjeta/ });
    expect(createHeader).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("button", { name: "Tarjetas" })).toHaveAttribute("aria-expanded", "true");

    // Collapsing the create section persists under its own key.
    fireEvent.click(createHeader);
    expect(window.localStorage.getItem("oc-collapse-editorial-create")).toBe("0");
  });

  it("sizes narrative fields taller than compact one-per-line list fields", async () => {
    server.use(emptyCardsHandler());
    renderCard();

    // Narrative textareas (Resumen / Postura) get the tall clamp.
    const resumen = await screen.findByLabelText("Resumen");
    expect(resumen.className).toContain("min-h-[96px]");
    expect(resumen.className).toContain("max-h-[240px]");
    expect(resumen.className).toContain("resize-y");
    expect(screen.getByLabelText("Postura del streamer").className).toContain("min-h-[96px]");

    // One-per-line list textareas get the compact clamp.
    const list = screen.getByLabelText("Contrapuntos (uno por línea)");
    expect(list.className).toContain("min-h-[64px]");
    expect(list.className).toContain("max-h-[160px]");
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

  it("renders single_use as a switch, off by default, with a one-line hint", async () => {
    server.use(emptyCardsHandler());
    renderCard();

    const toggle = await screen.findByRole("switch", { name: "De un solo uso" });
    expect(toggle).toHaveAttribute("aria-checked", "false");
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    expect(screen.getByText(/Kira la usa una sola vez y luego la retira/)).toBeInTheDocument();
  });

  it("checking single_use includes single_use:true in the POST body", async () => {
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
    fireEvent.click(screen.getByRole("switch", { name: "De un solo uso" }));
    expect(screen.getByRole("switch", { name: "De un solo uso" })).toHaveAttribute("aria-checked", "true");

    submitAndConfirm();

    await waitFor(() => expect(capturedBody).toMatchObject({ single_use: true }));
  });

  it("leaves single_use:false in the POST body when the checkbox is left unchecked", async () => {
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

    submitAndConfirm();

    await waitFor(() => expect(capturedBody).toMatchObject({ single_use: false }));
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

describe("EditorialCardsCard form sections + validation", () => {
  it("groups the fields into Contenido / Conversación / Datos y límites / Código y enlace with helper text", async () => {
    server.use(emptyCardsHandler());
    renderCard();

    expect(await screen.findByText("Contenido")).toBeInTheDocument();
    expect(screen.getByText(/De qué trata la tarjeta y qué opinas/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Conversación/ })).toHaveAttribute("aria-expanded", "true");
    // Optional sections start collapsed but stay mounted.
    expect(screen.getByRole("button", { name: /Datos y límites/ })).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByRole("button", { name: /Código y enlace/ })).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByLabelText("Datos obligatorios (uno por línea)")).toBeInTheDocument();
    expect(screen.getByLabelText("Código de descuento")).toBeInTheDocument();
  });

  it("keeps Save disabled and lists the missing required fields until topic/summary/take are filled", async () => {
    server.use(emptyCardsHandler());
    renderCard();

    const save = await screen.findByRole("button", { name: "Guardar tarjeta" });
    expect(save).toBeDisabled();
    expect(screen.getByLabelText("Tema")).toHaveAttribute("aria-required", "true");
    expect(screen.getByText("Completa para guardar: Tema, Resumen, Postura del streamer.")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Tema"), { target: { value: "   " } });
    expect(save).toBeDisabled();

    fireEvent.change(screen.getByLabelText("Tema"), { target: { value: "Algo" } });
    expect(screen.getByText("Completa para guardar: Resumen, Postura del streamer.")).toBeInTheDocument();

    await fillRequiredFields();
    expect(save).toBeEnabled();
    expect(screen.queryByText(/Completa para guardar/)).not.toBeInTheDocument();
  });
});

describe("EditorialCardsCard status filter + terminal cards", () => {
  const item = (over: Record<string, unknown>) => ({
    id: "c",
    topic: "T",
    topic_slug: "t",
    status: "draft",
    origin: "operator",
    expires_at: null,
    updated_at: "2026-10-04T00:00:00+00:00",
    single_use: false,
    active: false,
    ...over
  });
  const mixed = () =>
    http.get(`${API_BASE_URL}/api/agent/cards`, () =>
      HttpResponse.json({
        cards: [
          item({ id: "d", topic: "Draft topic", status: "draft" }),
          item({ id: "a", topic: "Armed topic", status: "armed" }),
          item({ id: "n", topic: "Running topic", status: "active" }),
          item({ id: "u", topic: "Used topic", status: "used" }),
          item({ id: "e", topic: "Expired topic", status: "expired" })
        ]
      })
    );
  const row = async (topic: string) => within((await screen.findByText(topic)).closest("li") as HTMLElement);

  it("shows counts per filter and switches between Activas / Deshabilitadas / Todas", async () => {
    server.use(mixed());
    renderCard();

    const activas = await screen.findByRole("button", { name: "Activas (3)" });
    const disabled = screen.getByRole("button", { name: "Deshabilitadas (2)" });
    const todas = screen.getByRole("button", { name: "Todas (5)" });
    expect(activas).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("Running topic")).toBeInTheDocument();
    expect(screen.queryByText("Used topic")).not.toBeInTheDocument();

    fireEvent.click(disabled);
    expect(screen.getByText("Used topic")).toBeInTheDocument();
    expect(screen.getByText("Expired topic")).toBeInTheDocument();
    expect(screen.queryByText("Draft topic")).not.toBeInTheDocument();

    fireEvent.click(todas);
    for (const topic of ["Draft topic", "Armed topic", "Running topic", "Used topic", "Expired topic"]) {
      expect(screen.getByText(topic)).toBeInTheDocument();
    }
  });

  it("labels every status with a localized badge in a distinct tone", async () => {
    server.use(mixed());
    renderCard();
    fireEvent.click(await screen.findByRole("button", { name: "Todas (5)" }));

    const expected: Array<[string, string, string]> = [
      ["Draft topic", "borrador", "neutral"],
      ["Armed topic", "armada", "info"],
      ["Running topic", "en curso", "ok"],
      ["Used topic", "usada", "warn"],
      ["Expired topic", "deshabilitada", "danger"]
    ];
    for (const [topic, label, tone] of expected) {
      const badge = (await row(topic)).getByText(label).closest("[data-tone]");
      expect(badge).toHaveAttribute("data-tone", tone);
    }
  });

  it("renders terminal cards muted with only Delete (plus Deactivate when still active)", async () => {
    server.use(
      http.get(`${API_BASE_URL}/api/agent/cards`, () =>
        HttpResponse.json({
          cards: [
            item({ id: "u", topic: "Used topic", status: "used" }),
            item({ id: "e", topic: "Expired topic", status: "expired", active: true })
          ]
        })
      )
    );
    renderCard();
    fireEvent.click(await screen.findByRole("button", { name: "Deshabilitadas (2)" }));

    const used = await row("Used topic");
    expect((screen.getByText("Used topic").closest("li") as HTMLElement).dataset.muted).toBe("true");
    expect(used.getByRole("button", { name: "Eliminar" })).toBeInTheDocument();
    for (const name of ["Armar", "Activar", "Deshabilitar", "Datos verificados", "Desactivar"]) {
      expect(used.queryByRole("button", { name })).not.toBeInTheDocument();
    }

    const expired = await row("Expired topic");
    expect(expired.getByRole("button", { name: "Desactivar" })).toBeInTheDocument();
    expect(expired.queryByRole("button", { name: "Activar" })).not.toBeInTheDocument();
  });

  it("keeps non-terminal rows unmuted with their actions", async () => {
    server.use(mixed());
    renderCard();
    const running = await row("Running topic");
    expect((screen.getByText("Running topic").closest("li") as HTMLElement).dataset.muted).toBeUndefined();
    expect(running.queryByRole("button", { name: "Armar" })).not.toBeInTheDocument();
    expect(running.getByRole("button", { name: "Activar" })).toBeInTheDocument();
    expect(running.getByRole("button", { name: "Deshabilitar" })).toBeInTheDocument();
  });

  it("shows the Activas empty state when only terminal cards exist", async () => {
    server.use(
      http.get(`${API_BASE_URL}/api/agent/cards`, () =>
        HttpResponse.json({ cards: [item({ id: "u", topic: "Used topic", status: "used" })] })
      )
    );
    renderCard();

    expect(await screen.findByText("No hay tarjetas en borrador, armadas ni en curso.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Deshabilitadas (1)" }));
    expect(screen.getByText("Used topic")).toBeInTheDocument();
  });

  it("shows the Deshabilitadas and Todas empty states", async () => {
    server.use(emptyCardsHandler());
    renderCard();
    fireEvent.click(await screen.findByRole("button", { name: "Deshabilitadas (0)" }));
    expect(screen.getByText("No hay tarjetas deshabilitadas ni usadas.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Todas (0)" }));
    expect(screen.getByText("Todavía no hay tarjetas.")).toBeInTheDocument();
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
      single_use: false,
      ...overrides
    };
  }

  it("defaults to the Activas filter: draft/armed/active rows, not used/expired/disabled", async () => {
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
    expect(screen.getByRole("button", { name: "Activas (2)" })).toHaveAttribute("aria-pressed", "true");
  });

  it("shows a 'de un solo uso' badge only on single_use rows", async () => {
    server.use(
      listWith([
        card({ id: "c1", topic: "Reusable topic", status: "draft", single_use: false }),
        card({ id: "c2", topic: "Single use topic", status: "armed", single_use: true })
      ])
    );
    renderCard();

    await waitFor(() => expect(screen.getByText("Reusable topic")).toBeInTheDocument());
    const reusableRow = screen.getByText("Reusable topic").closest("li") as HTMLElement;
    const singleUseRow = screen.getByText("Single use topic").closest("li") as HTMLElement;
    expect(within(reusableRow).queryByText("de un solo uso")).not.toBeInTheDocument();
    expect(within(singleUseRow).getByText("de un solo uso")).toBeInTheDocument();
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
      expect(screen.getByText("No hay sesión de operador válida. Reabre la app.")).toBeInTheDocument()
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
          "El servidor rechazó la tarjeta: topic must not be empty. Acorta el texto o repártelo en los campos."
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
      expect(screen.getByText("Demasiadas operaciones seguidas. Espera un minuto.")).toBeInTheDocument()
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
      expect(screen.getByText("La base de tarjetas no responde. Prueba de nuevo en un rato.")).toBeInTheDocument()
    );
  });
});

describe("EditorialCardsCard active cards", () => {
  const listItem = (over: Record<string, unknown> = {}) => ({
    id: "card_a",
    topic: "Acme",
    topic_slug: "acme",
    status: "armed",
    origin: "",
    expires_at: null,
    updated_at: "2026-10-04T00:00:00+00:00",
    single_use: false,
    active: false,
    ...over
  });
  const activeOut = (over: Record<string, unknown> = {}) => ({
    ...listItem(),
    summary: "s",
    streamer_take: "t",
    must_say: ["Devolución 30 días"],
    forbidden_claims: ["el mejor del mundo"],
    discount_code: "KIRA10",
    link: "acme.example/kira",
    ...over
  });
  const listWith = (...cards: Record<string, unknown>[]) =>
    http.get(`${API_BASE_URL}/api/agent/cards`, () => HttpResponse.json({ cards }));
  const row = async (topic: string) => within((await screen.findByText(topic)).closest("li") as HTMLElement);

  it("shows the verified-facts fields and the helper text in the create form", async () => {
    server.use(emptyCardsHandler());
    renderCard();
    expect(await screen.findByLabelText("Datos obligatorios (uno por línea)")).toBeInTheDocument();
    expect(screen.queryByLabelText("Producto")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Frases prohibidas (una por línea)")).toBeInTheDocument();
    expect(screen.getByLabelText("Código de descuento")).toBeInTheDocument();
    expect(screen.getByLabelText("Enlace")).toBeInTheDocument();
    expect(screen.getByText(/se bloquean siempre, solo con la redacción exacta/)).toBeInTheDocument();
    expect(screen.getByText(/solo se usa cuando la conversación se relaciona/)).toBeInTheDocument();
    // Neutral wording (1648404): no sponsorship framing anywhere in the card;
    // the create form groups discount code + link under "Código y enlace" (U6).
    expect(document.body.textContent).not.toMatch(/atrocin/);
  });

  it("sends verified facts on create and omits them when left empty", async () => {
    const bodies: Record<string, unknown>[] = [];
    server.use(emptyCardsHandler());
    server.use(
      http.post(`${API_BASE_URL}/api/agent/cards`, async ({ request }) => {
        bodies.push((await request.json()) as Record<string, unknown>);
        return HttpResponse.json({ id: "c", topic_slug: "c", status: "draft", demoted: false });
      })
    );
    renderCard();
    await fillRequiredFields();
    submitAndConfirm();
    await waitFor(() => expect(bodies).toHaveLength(1));
    expect(bodies[0]).not.toHaveProperty("must_say");

    await fillRequiredFields();
    fireEvent.change(screen.getByLabelText("Datos obligatorios (uno por línea)"), { target: { value: "a\n b \n" } });
    fireEvent.change(screen.getByLabelText("Frases prohibidas (una por línea)"), { target: { value: "x" } });
    fireEvent.change(screen.getByLabelText("Código de descuento"), { target: { value: "KIRA10" } });
    fireEvent.change(screen.getByLabelText("Enlace"), { target: { value: "acme.example" } });
    submitAndConfirm();
    await waitFor(() => expect(bodies).toHaveLength(2));
    expect(bodies[1]).not.toHaveProperty("product");
    expect(bodies[1]).toMatchObject({
      must_say: ["a", "b"],
      forbidden_claims: ["x"],
      discount_code: "KIRA10",
      link: "acme.example"
    });
  });

  it("badges every active card and offers Activate/Deactivate accordingly", async () => {
    server.use(
      listWith(
        listItem({ id: "p", topic: "Primera card", active: true }),
        listItem({ id: "r", topic: "Segunda card", active: true }),
        listItem({ id: "q", topic: "Otra" })
      )
    );
    renderCard();
    const first = await row("Primera card");
    const second = await row("Segunda card");
    const other = await row("Otra");
    expect(first.getByText("activa")).toBeInTheDocument();
    expect(second.getByText("activa")).toBeInTheDocument();
    expect(first.getByRole("button", { name: "Desactivar" })).toBeInTheDocument();
    expect(other.queryByText("activa")).not.toBeInTheDocument();
    expect(other.getByRole("button", { name: "Activar" })).toBeInTheDocument();
  });

  it("activating a card keeps the other active card active", async () => {
    const activeIds = new Set(["p"]);
    server.use(
      http.get(`${API_BASE_URL}/api/agent/cards`, () =>
        HttpResponse.json({
          cards: [
            listItem({ id: "p", topic: "Primera", active: activeIds.has("p") }),
            listItem({ id: "q", topic: "Segunda", active: activeIds.has("q") })
          ]
        })
      ),
      http.post(`${API_BASE_URL}/api/editorial/cards/q/activate`, () => {
        activeIds.add("q");
        return HttpResponse.json({ id: "q", active: true });
      })
    );
    renderCard();
    fireEvent.click(await (await row("Segunda")).findByRole("button", { name: "Activar" }));
    await waitFor(async () => expect((await row("Segunda")).getByText("activa")).toBeInTheDocument());
    expect((await row("Primera")).getByText("activa")).toBeInTheDocument();
    expect(screen.getAllByText("activa")).toHaveLength(2);
  });

  it("deactivates an active card", async () => {
    let called = false;
    server.use(
      listWith(listItem({ id: "p", topic: "Primera", active: true })),
      http.post(`${API_BASE_URL}/api/editorial/cards/p/deactivate`, () => {
        called = true;
        return HttpResponse.json({ id: "p", active: false });
      })
    );
    renderCard();
    fireEvent.click(await (await row("Primera")).findByRole("button", { name: "Desactivar" }));
    await waitFor(() => expect(called).toBe(true));
  });

  it("disable asks for confirmation before calling the route", async () => {
    let called = false;
    server.use(
      listWith(listItem()),
      http.post(`${API_BASE_URL}/api/editorial/cards/card_a/disable`, () => {
        called = true;
        return HttpResponse.json({ id: "card_a", status: "expired" });
      })
    );
    renderCard();
    fireEvent.click(await (await row("Acme")).findByRole("button", { name: "Deshabilitar" }));
    expect(called).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Confirmar" }));
    await waitFor(() => expect(called).toBe(true));
  });

  it("delete warns it is irreversible, can be cancelled, and only then calls DELETE", async () => {
    let called = false;
    server.use(
      listWith(listItem()),
      http.delete(`${API_BASE_URL}/api/editorial/cards/card_a`, () => {
        called = true;
        return HttpResponse.json({ id: "card_a", deleted: true });
      })
    );
    renderCard();
    fireEvent.click(await (await row("Acme")).findByRole("button", { name: "Eliminar" }));
    expect(screen.getByText(/No se puede deshacer/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(called).toBe(false);
    fireEvent.click((await row("Acme")).getByRole("button", { name: "Eliminar" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirmar" }));
    await waitFor(() => expect(called).toBe(true));
  });

  it("a backend without the active card routes shows a quiet note and keeps the list working", async () => {
    server.use(
      listWith(listItem()),
      http.post(`${API_BASE_URL}/api/editorial/cards/card_a/activate`, () =>
        HttpResponse.json({ detail: "Not Found" }, { status: 404 })
      )
    );
    renderCard();
    fireEvent.click(await (await row("Acme")).findByRole("button", { name: "Activar" }));
    expect(await screen.findByText(/todavía no están disponibles en este backend/)).toBeInTheDocument();
    expect(screen.getByText("Acme")).toBeInTheDocument();
  });

  it("shows a 409 refusal inline", async () => {
    server.use(
      listWith(listItem()),
      http.post(`${API_BASE_URL}/api/editorial/cards/card_a/activate`, () =>
        HttpResponse.json({ detail: "card_not_activatable" }, { status: 409 })
      )
    );
    renderCard();
    fireEvent.click(await (await row("Acme")).findByRole("button", { name: "Activar" }));
    expect(await screen.findByText(/no se puede activar o deshabilitar/)).toBeInTheDocument();
  });

  it("edits verified facts of an existing card via GET then PUT", async () => {
    let putBody: Record<string, unknown> | undefined;
    server.use(
      listWith(listItem()),
      http.get(`${API_BASE_URL}/api/editorial/cards/card_a`, () => HttpResponse.json(activeOut())),
      http.put(`${API_BASE_URL}/api/editorial/cards/card_a/fields`, async ({ request }) => {
        putBody = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json(activeOut());
      })
    );
    renderCard();
    fireEvent.click(await (await row("Acme")).findByRole("button", { name: "Datos verificados" }));
    const li = await row("Acme");
    await li.findByDisplayValue("acme.example/kira");
    fireEvent.change(li.getByLabelText("Frases prohibidas (una por línea)"), {
      target: { value: "uno\ndos" }
    });
    fireEvent.click(li.getByRole("button", { name: "Guardar datos verificados" }));
    await waitFor(() =>
      expect(putBody).toEqual({
        must_say: ["Devolución 30 días"],
        forbidden_claims: ["uno", "dos"],
        discount_code: "KIRA10",
        link: "acme.example/kira"
      })
    );
  });

  it("shows a 422 from the verified-facts save inline", async () => {
    server.use(
      listWith(listItem()),
      http.get(`${API_BASE_URL}/api/editorial/cards/card_a`, () => HttpResponse.json(activeOut())),
      http.put(`${API_BASE_URL}/api/editorial/cards/card_a/fields`, () =>
        HttpResponse.json({ detail: "link too long" }, { status: 422 })
      )
    );
    renderCard();
    fireEvent.click(await (await row("Acme")).findByRole("button", { name: "Datos verificados" }));
    const li = await row("Acme");
    await li.findByDisplayValue("acme.example/kira");
    fireEvent.click(li.getByRole("button", { name: "Guardar datos verificados" }));
    expect(await screen.findByText(/link too long/)).toBeInTheDocument();
  });

  it("shows the unavailable note when the card GET route is missing", async () => {
    server.use(
      listWith(listItem()),
      http.get(`${API_BASE_URL}/api/editorial/cards/card_a`, () =>
        HttpResponse.json({ detail: "Not Found" }, { status: 404 })
      )
    );
    renderCard();
    fireEvent.click(await (await row("Acme")).findByRole("button", { name: "Datos verificados" }));
    expect(await screen.findByText(/todavía no están disponibles en este backend/)).toBeInTheDocument();
  });
});

describe("EditorialCardsCard list limit blocking & ActiveCardEditor state", () => {
  const listWith = (cards: unknown[]) =>
    http.get(`${API_BASE_URL}/api/agent/cards`, () => HttpResponse.json({ cards }));
  const listItem = (over: Record<string, unknown> = {}) => ({
    id: "card_a",
    topic: "Acme",
    topic_slug: "acme",
    status: "draft",
    origin: "operator",
    expires_at: null,
    updated_at: "2026-10-04T00:00:00+00:00",
    single_use: false,
    active: false,
    ...over
  });
  const activeOut = (over: Record<string, unknown> = {}) => ({
    id: "card_a",
    topic: "Acme",
    topic_slug: "acme",
    status: "draft",
    origin: "",
    active: false,
    must_say: ["Devolución 30 días"],
    forbidden_claims: ["cura la ansiedad"],
    discount_code: "KIRA10",
    link: "acme.example/kira",
    ...over
  });
  const row = async (topic: string) => within((await screen.findByText(topic)).closest("li") as HTMLElement);

  it("blocks Save and surfaces role=alert feedback when >8 lines or >240 chars are entered (including verified facts)", async () => {
    let postCalls = 0;
    server.use(
      emptyCardsHandler(),
      http.post(`${API_BASE_URL}/api/agent/cards`, () => {
        postCalls += 1;
        return HttpResponse.json({ id: "card_a", topic_slug: "t", status: "draft", demoted: false });
      })
    );
    renderCard();
    await fillRequiredFields();
    const save = screen.getByRole("button", { name: "Guardar tarjeta" });
    expect(save).toBeEnabled();

    const nineLines = Array.from({ length: 9 }, (_, i) => `item ${i}`).join("\n");
    fireEvent.change(screen.getByLabelText("Disparadores (uno por línea)"), { target: { value: nineLines } });
    expect(save).toBeDisabled();
    expect(screen.getByRole("alert")).toHaveTextContent("Solo se guardan las primeras 8 líneas.");
    expect(postCalls).toBe(0);

    // Reducing back to 8 non-empty lines unlocks Save.
    const eightLines = Array.from({ length: 8 }, (_, i) => `item ${i}`).join("\n");
    fireEvent.change(screen.getByLabelText("Disparadores (uno por línea)"), { target: { value: eightLines } });
    expect(save).toBeEnabled();

    // >240 chars in Contrapuntos disables Save and surfaces alert feedback.
    fireEvent.change(screen.getByLabelText("Contrapuntos (uno por línea)"), { target: { value: "a".repeat(241) } });
    expect(save).toBeDisabled();
    expect(screen.getByRole("alert")).toHaveTextContent("Cada línea puede tener hasta 240 caracteres.");

    // Clear Contrapuntos, put 9 lines into Datos obligatorios -> still blocks Save.
    fireEvent.change(screen.getByLabelText("Contrapuntos (uno por línea)"), { target: { value: "" } });
    fireEvent.change(screen.getByLabelText("Datos obligatorios (uno por línea)"), { target: { value: nineLines } });
    expect(save).toBeDisabled();
    expect(screen.getByRole("alert")).toHaveTextContent("Solo se guardan las primeras 8 líneas.");
  });

  it("ActiveCardEditor clears save success/error notices on edit and blocks save on >8 lines or >240 chars", async () => {
    let failSave = false;
    server.use(
      listWith([listItem()]),
      http.get(`${API_BASE_URL}/api/editorial/cards/card_a`, () => HttpResponse.json(activeOut())),
      http.put(`${API_BASE_URL}/api/editorial/cards/card_a/fields`, () => {
        if (failSave) {
          return HttpResponse.json({ detail: "link too long" }, { status: 422 });
        }
        return HttpResponse.json(activeOut());
      })
    );
    renderCard();
    fireEvent.click(await (await row("Acme")).findByRole("button", { name: "Datos verificados" }));
    const li = await row("Acme");
    await li.findByDisplayValue("acme.example/kira");

    // 1. Save succeeds, then editing clears the stale success notice.
    fireEvent.click(li.getByRole("button", { name: "Guardar datos verificados" }));
    await li.findByText("Datos verificados guardados.");
    fireEvent.change(li.getByLabelText("Código de descuento"), { target: { value: "KIRA20" } });
    expect(li.queryByText("Datos verificados guardados.")).not.toBeInTheDocument();

    // 2. Save fails 422, then editing clears the stale error alert.
    failSave = true;
    fireEvent.click(li.getByRole("button", { name: "Guardar datos verificados" }));
    await li.findByText(/link too long/);
    fireEvent.change(li.getByLabelText("Enlace"), { target: { value: "acme.example/short" } });
    expect(li.queryByText(/link too long/)).not.toBeInTheDocument();

    // 3. >8 lines or >240 chars in verified facts surfaces alert and disables Save.
    const nineLines = Array.from({ length: 9 }, (_, i) => `fact ${i}`).join("\n");
    fireEvent.change(li.getByLabelText("Frases prohibidas (una por línea)"), { target: { value: nineLines } });
    expect(li.getByRole("button", { name: "Guardar datos verificados" })).toBeDisabled();
    expect(li.getByRole("alert")).toHaveTextContent("Solo se guardan las primeras 8 líneas.");

    fireEvent.change(li.getByLabelText("Frases prohibidas (una por línea)"), { target: { value: "ok" } });
    fireEvent.change(li.getByLabelText("Datos obligatorios (uno por línea)"), { target: { value: "b".repeat(241) } });
    expect(li.getByRole("button", { name: "Guardar datos verificados" })).toBeDisabled();
    expect(li.getByRole("alert")).toHaveTextContent("Cada línea puede tener hasta 240 caracteres.");
  });

  it("ActiveCardEditor clears loadError and stale draft before loading when cardId changes", async () => {
    server.use(
      http.get(`${API_BASE_URL}/api/editorial/cards/card_bad`, () =>
        HttpResponse.json({ detail: "boom" }, { status: 503 })
      ),
      http.get(`${API_BASE_URL}/api/editorial/cards/card_good`, () =>
        HttpResponse.json(activeOut({ id: "card_good", link: "good.example/ok" }))
      )
    );
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrap = (cardId: string) =>
      React.createElement(QueryClientProvider, { client: queryClient }, React.createElement(ActiveCardEditor, { cardId }));

    const { rerender } = render(wrap("card_bad"));
    await screen.findByText(/La base de tarjetas no responde/);

    rerender(wrap("card_good"));
    await screen.findByDisplayValue("good.example/ok");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
