import { http, HttpResponse } from "msw";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import React from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useUiLocaleStore } from "../../i18n/locale.js";
import { server } from "../../test/server.js";
import { API_BASE_URL } from "../../test/handlers.js";
import { EN, ES } from "../../i18n/bundles.js";
import { GUARDRAIL_COPY } from "./guardrailCopy.js";
import { GuardrailsCard } from "./GuardrailsCard.js";

type Rule = { id: string; tier: "locked" | "toggleable"; category: "safety" | "persona" | "style"; enabled: boolean };

const BASE: Rule[] = [
  { id: "no_hate_speech", tier: "locked", category: "safety", enabled: true },
  { id: "no_ai_self_identification", tier: "toggleable", category: "persona", enabled: true },
  { id: "no_meta_commentary", tier: "toggleable", category: "style", enabled: true },
  { id: "no_doxxing", tier: "locked", category: "safety", enabled: true }
];

function renderCard() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(React.createElement(QueryClientProvider, { client: queryClient }, React.createElement(GuardrailsCard)));
}

function serve(initial: Rule[], opts: { putStatus?: number; gate?: Promise<void> } = {}) {
  const state = { rules: initial, puts: [] as string[][] };
  server.use(
    http.get(`${API_BASE_URL}/api/guardrails`, () => HttpResponse.json({ rules: state.rules })),
    http.put(`${API_BASE_URL}/api/guardrails`, async ({ request }) => {
      const body = (await request.json()) as { disabled: string[] };
      state.puts.push(body.disabled);
      if (opts.gate) await opts.gate;
      if (opts.putStatus && opts.putStatus !== 200) {
        return HttpResponse.json({ detail: "guardrails_write_failed" }, { status: opts.putStatus });
      }
      state.rules = state.rules.map((r) =>
        r.tier === "toggleable" ? { ...r, enabled: !body.disabled.includes(r.id) } : r
      );
      return HttpResponse.json({ rules: state.rules });
    })
  );
  return state;
}

describe("GuardrailsCard", () => {
  // Test default locale is es; assert on the en copy.
  beforeEach(() => useUiLocaleStore.setState({ locale: "en" }));
  afterEach(() => useUiLocaleStore.setState({ locale: "es" }));

  it("renders toggleable rules with a switch and locked rules without any control", async () => {
    serve(BASE);
    renderCard();
    const sw = await screen.findByRole("switch", { name: "No generic AI self-identification" });
    expect(sw).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("switch", { name: "No meta commentary" })).toBeInTheDocument();
    expect(screen.getAllByRole("switch")).toHaveLength(2);
    const locked = screen.getByTestId("guardrail-rule-no_hate_speech");
    expect(within(locked).queryByRole("switch")).toBeNull();
    expect(within(locked).getByText("Always on: platform safety")).toBeInTheDocument();
    expect(within(locked).getByTestId("guardrail-lock")).toBeInTheDocument();
  });

  it("shows no_code_output as a locked row with en copy and no switch", async () => {
    serve([...BASE, { id: "no_code_output", tier: "locked", category: "safety", enabled: true }]);
    renderCard();
    const row = await screen.findByTestId("guardrail-rule-no_code_output");
    expect(within(row).getByText("No code or templates aloud")).toBeInTheDocument();
    expect(
      within(row).getByText(
        "Kira never answers with code, JSON, config files or templates, even if asked. She explains in spoken words instead."
      )
    ).toBeInTheDocument();
    expect(within(row).queryByRole("switch")).toBeNull();
    expect(within(row).getByTestId("guardrail-lock")).toBeInTheDocument();
    expect(screen.getAllByRole("switch")).toHaveLength(2);
  });

  it("shows no_code_output with es copy", async () => {
    useUiLocaleStore.setState({ locale: "es" });
    serve([{ id: "no_code_output", tier: "locked", category: "safety", enabled: true }]);
    renderCard();
    const row = await screen.findByTestId("guardrail-rule-no_code_output");
    expect(within(row).getByText("Sin código ni plantillas en voz alta")).toBeInTheDocument();
    expect(
      within(row).getByText(
        "Kira nunca responde con código, JSON, archivos de configuración ni plantillas, aunque se lo pidan. Lo explica con palabras."
      )
    ).toBeInTheDocument();
    expect(within(row).queryByRole("switch")).toBeNull();
  });

  it.each([
    [
      "no_memory_denial",
      "en",
      "Never denies having memory",
      "Kira never says she has no persistent memory. She uses the memories shown, or says she has nothing saved."
    ],
    [
      "no_memory_denial",
      "es",
      "Nunca niega tener memoria",
      "Kira nunca dice que no tiene memoria persistente. Usa los recuerdos que ve, o dice que no tiene nada guardado."
    ],
    [
      "no_false_capability",
      "en",
      "No false capabilities",
      "Kira never claims she can generate or edit images, video, audio or files. She says so briefly and offers words instead."
    ],
    [
      "no_false_capability",
      "es",
      "Sin capacidades falsas",
      "Kira nunca dice que puede generar o editar imágenes, video, audio o archivos. Lo dice con claridad y ofrece palabras."
    ]
  ] as const)("shows %s as a locked row with %s copy and no switch", async (id, locale, name, desc) => {
    useUiLocaleStore.setState({ locale });
    serve([...BASE, { id, tier: "locked", category: "safety", enabled: true }]);
    renderCard();
    const row = await screen.findByTestId(`guardrail-rule-${id}`);
    expect(within(row).getByText(name)).toBeInTheDocument();
    expect(within(row).getByText(desc)).toBeInTheDocument();
    expect(within(row).queryByRole("switch")).toBeNull();
    expect(within(row).getByTestId("guardrail-lock")).toBeInTheDocument();
  });

  it("derives toggleability from the API tier, not from the rule id", async () => {
    serve([{ id: "no_hate_speech", tier: "toggleable", category: "safety", enabled: true }]);
    renderCard();
    expect(await screen.findByRole("switch", { name: "No hate speech" })).toBeInTheDocument();
  });

  it("lists toggleable rules before the locked safety rules", async () => {
    serve(BASE);
    renderCard();
    await screen.findByRole("switch", { name: "No meta commentary" });
    const ids = screen.getAllByTestId(/^guardrail-rule-/).map((el) => el.getAttribute("data-testid"));
    expect(ids.slice(0, 2).sort()).toEqual(["guardrail-rule-no_ai_self_identification", "guardrail-rule-no_meta_commentary"]);
    expect(ids.slice(2)).toEqual(["guardrail-rule-no_hate_speech", "guardrail-rule-no_doxxing"]);
  });

  it("shows the output-filter note covering agenda segments for self-identification", async () => {
    serve(BASE);
    renderCard();
    const row = await screen.findByTestId("guardrail-rule-no_ai_self_identification");
    expect(within(row).getByText(/Disables the output filter/)).toBeInTheDocument();
    expect(within(row).getByText(/replies and agenda segments/)).toBeInTheDocument();
  });

  it("toggling off sends the full disabled list and reflects the saved state", async () => {
    const user = userEvent.setup();
    const state = serve(BASE);
    renderCard();
    await user.click(await screen.findByRole("switch", { name: "No generic AI self-identification" }));
    await waitFor(() => expect(state.puts).toEqual([["no_ai_self_identification"]]));
    await waitFor(() =>
      expect(screen.getByRole("switch", { name: "No generic AI self-identification" })).toHaveAttribute("aria-checked", "false")
    );
    await user.click(screen.getByRole("switch", { name: "No meta commentary" }));
    await waitFor(() => expect(state.puts[1].slice().sort()).toEqual(["no_ai_self_identification", "no_meta_commentary"]));
  });

  it("toggling a disabled rule back on removes it from the list", async () => {
    const user = userEvent.setup();
    const state = serve(BASE.map((r) => (r.id === "no_meta_commentary" ? { ...r, enabled: false } : r)));
    renderCard();
    const sw = await screen.findByRole("switch", { name: "No meta commentary" });
    expect(sw).toHaveAttribute("aria-checked", "false");
    await user.click(sw);
    await waitFor(() => expect(state.puts).toEqual([[]]));
  });

  it("updates optimistically and disables switches while saving", async () => {
    const user = userEvent.setup();
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    serve(BASE, { gate });
    renderCard();
    const sw = await screen.findByRole("switch", { name: "No generic AI self-identification" });
    await user.click(sw);
    await waitFor(() => expect(sw).toHaveAttribute("aria-checked", "false"));
    expect(screen.getByRole("switch", { name: "No meta commentary" })).toBeDisabled();
    release();
    await waitFor(() => expect(screen.getByRole("switch", { name: "No meta commentary" })).toBeEnabled());
  });

  it("rolls back and shows an inline error when the save fails", async () => {
    const user = userEvent.setup();
    serve(BASE, { putStatus: 503 });
    renderCard();
    const sw = await screen.findByRole("switch", { name: "No generic AI self-identification" });
    await user.click(sw);
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not save the guardrails. Try again.");
    await waitFor(() => expect(sw).toHaveAttribute("aria-checked", "true"));
  });

  it("shows a load error when the list cannot be fetched", async () => {
    server.use(http.get(`${API_BASE_URL}/api/guardrails`, () => new HttpResponse(null, { status: 500 })));
    renderCard();
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not load the guardrails.");
  });

  it("renders an unknown rule id raw with a generic description", async () => {
    serve([{ id: "future_rule_x", tier: "locked", category: "safety", enabled: true }]);
    renderCard();
    const row = await screen.findByTestId("guardrail-rule-future_rule_x");
    expect(within(row).getByText("future_rule_x")).toBeInTheDocument();
    expect(within(row).getByText("No description available for this rule.")).toBeInTheDocument();
  });

  it("an unknown toggleable id still gets a working switch", async () => {
    const user = userEvent.setup();
    const state = serve([{ id: "future_rule_y", tier: "toggleable", category: "style", enabled: true }]);
    renderCard();
    await user.click(await screen.findByRole("switch", { name: "future_rule_y" }));
    await waitFor(() => expect(state.puts).toEqual([["future_rule_y"]]));
  });

  it("renders neutral Spanish copy", async () => {
    useUiLocaleStore.setState({ locale: "es" });
    serve(BASE);
    renderCard();
    expect(await screen.findAllByText("Siempre activa: seguridad de la plataforma")).not.toHaveLength(0);
  });

  it("has en and es copy for every known rule id", () => {
    expect(Object.keys(GUARDRAIL_COPY)).toHaveLength(15);
    for (const copy of Object.values(GUARDRAIL_COPY)) {
      for (const key of [copy.name, copy.desc, ...(copy.note ? [copy.note] : [])]) {
        expect(EN[key]).toBeTruthy();
        expect(ES[key]).toBeTruthy();
      }
    }
  });

  it("collapses and expands on header click, persisting state to localStorage", async () => {
    const user = userEvent.setup();
    window.localStorage.clear();
    serve(BASE);
    renderCard();
    const header = await screen.findByRole("button", { name: /Guardrails/i });
    expect(header).toHaveAttribute("aria-expanded", "true");
    await user.click(header);
    expect(header).toHaveAttribute("aria-expanded", "false");
    expect(window.localStorage.getItem("oc-collapse-guardrails")).toBe("0");
    await user.click(header);
    expect(header).toHaveAttribute("aria-expanded", "true");
    expect(window.localStorage.getItem("oc-collapse-guardrails")).toBe("1");
  });
});
