import { http, HttpResponse } from "msw";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useUiLocaleStore } from "../../i18n/locale.js";
import { server } from "../../test/server.js";
import { API_BASE_URL, defaultI18nState, defaultPersonalization, i18nStateHandler } from "../../test/handlers.js";
import { PersonalizationCard } from "./PersonalizationCard.js";

// Collapse state persists to localStorage (oc-collapse-*); clear between tests
// so the default-closed destructive section can't leak an opened state forward.
beforeEach(() => {
  window.localStorage.clear();
  useUiLocaleStore.setState({ locale: "es" });
});
afterEach(() => {
  useUiLocaleStore.setState({ locale: "es" });
});

function renderCard() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const utils = render(
    React.createElement(QueryClientProvider, { client: queryClient }, React.createElement(PersonalizationCard))
  );
  return { ...utils, queryClient };
}

describe("PersonalizationCard loads from GET /api/personalization", () => {
  it("renders the form seeded from the fetched document", async () => {
    server.use(
      http.get(`${API_BASE_URL}/api/personalization`, () =>
        HttpResponse.json({ ...defaultPersonalization, nickname: "Fran", occupation: "Streamer" })
      )
    );
    renderCard();

    await waitFor(() => expect(screen.getByLabelText("Apodo")).toHaveValue("Fran"));
    expect(screen.getByLabelText("Ocupación")).toHaveValue("Streamer");
    expect(screen.getByLabelText("Habilitar personalización")).toHaveAttribute("aria-checked", "true");
  });

  it("surfaces a GET error honestly instead of a blank/stale form", async () => {
    server.use(
      http.get(`${API_BASE_URL}/api/personalization`, () => HttpResponse.json({ detail: "boom" }, { status: 500 }))
    );
    renderCard();
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
  });

  it("mirrors the API field caps as maxLength attributes", async () => {
    renderCard();
    await waitFor(() => expect(screen.getByLabelText("Apodo")).toBeInTheDocument());

    expect(screen.getByLabelText("Apodo")).toHaveAttribute("maxLength", "60");
    expect(screen.getByLabelText("Ocupación")).toHaveAttribute("maxLength", "120");
    expect(screen.getByLabelText("Intereses")).toHaveAttribute("maxLength", "240");
    expect(screen.getByLabelText("Instrucciones personalizadas")).toHaveAttribute("maxLength", "400");
  });
});

describe("PersonalizationCard collapsible sections + textarea sizing", () => {
  it("keeps the form open by default and the destructive section closed", async () => {
    renderCard();
    await waitFor(() => expect(screen.getByLabelText("Apodo")).toBeInTheDocument());

    expect(screen.getByRole("button", { name: "Tus datos" })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("button", { name: "Borrar datos guardados" })).toHaveAttribute("aria-expanded", "false");
  });

  it("opening the destructive section persists under its own key", async () => {
    renderCard();
    await waitFor(() => expect(screen.getByLabelText("Apodo")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "Borrar datos guardados" }));
    expect(screen.getByRole("button", { name: "Borrar datos guardados" })).toHaveAttribute("aria-expanded", "true");
    expect(window.localStorage.getItem("oc-collapse-personalization-clear")).toBe("1");
  });

  it("gives the instructions textarea the tall narrative clamp", async () => {
    renderCard();
    await waitFor(() => expect(screen.getByLabelText("Instrucciones personalizadas")).toBeInTheDocument());

    const ta = screen.getByLabelText("Instrucciones personalizadas");
    expect(ta.className).toContain("min-h-[96px]");
    expect(ta.className).toContain("max-h-[240px]");
    expect(ta.className).toContain("resize-y");
  });
});

describe("PersonalizationCard Guardar (PUT /api/personalization)", () => {
  it("saves the edited form and reflects the persisted response", async () => {
    let capturedBody: unknown;
    server.use(
      http.put(`${API_BASE_URL}/api/personalization`, async ({ request }) => {
        capturedBody = await request.json();
        return HttpResponse.json({ ...defaultPersonalization, ...(capturedBody as object) });
      })
    );
    renderCard();
    await waitFor(() => expect(screen.getByLabelText("Apodo")).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText("Apodo"), { target: { value: "Kira" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));

    await waitFor(() =>
      expect(capturedBody).toEqual({
        enabled: true,
        nickname: "Kira",
        occupation: "",
        interests: "",
        custom_instructions: ""
      })
    );
    await waitFor(() => expect(screen.getByLabelText("Apodo")).toHaveValue("Kira"));
  });

  it("surfaces a 422 validation error from the backend honestly", async () => {
    server.use(
      http.put(`${API_BASE_URL}/api/personalization`, () =>
        HttpResponse.json({ detail: "nickname exceeds max length" }, { status: 422 })
      )
    );
    renderCard();
    await waitFor(() => expect(screen.getByLabelText("Apodo")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("nickname exceeds max length"));
  });
});

describe("PersonalizationCard Limpiar — confirm step (DELETE /api/personalization)", () => {
  it("keeps the destructive section's body inert/aria-hidden while collapsed, before it's ever expanded", async () => {
    renderCard();
    await waitFor(() => expect(screen.getByLabelText("Apodo")).toBeInTheDocument());

    const header = screen.getByRole("button", { name: "Borrar datos guardados" });
    expect(header).toHaveAttribute("aria-expanded", "false");
    const bodyId = header.getAttribute("aria-controls") as string;
    expect(bodyId).toBeTruthy();
    const body = document.getElementById(bodyId) as HTMLElement;
    expect(body).toHaveAttribute("inert");
    expect(body).toHaveAttribute("aria-hidden", "true");
    // The Limpiar button lives inside the still-collapsed body, unreachable
    // by role query — proof the destructive action isn't tabbable while hidden.
    expect(screen.queryByRole("button", { name: "Limpiar" })).not.toBeInTheDocument();
  });

  it("requires a confirm step, Cancelar backs out without deleting", async () => {
    let calls = 0;
    server.use(
      http.delete(`${API_BASE_URL}/api/personalization`, () => {
        calls += 1;
        return HttpResponse.json({ ok: true });
      })
    );
    renderCard();
    await waitFor(() => expect(screen.getByLabelText("Apodo")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "Borrar datos guardados" }));
    fireEvent.click(screen.getByRole("button", { name: "Limpiar" }));
    expect(screen.getByText(/No se puede deshacer/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(screen.queryByText(/No se puede deshacer/)).not.toBeInTheDocument();
    expect(calls).toBe(0);
  });

  it("confirming clears the store and reloads the emptied defaults", async () => {
    server.use(
      http.get(`${API_BASE_URL}/api/personalization`, () =>
        HttpResponse.json({ ...defaultPersonalization, nickname: "Fran" })
      )
    );
    renderCard();
    await waitFor(() => expect(screen.getByLabelText("Apodo")).toHaveValue("Fran"));

    server.use(http.delete(`${API_BASE_URL}/api/personalization`, () => HttpResponse.json({ ok: true })));
    server.use(http.get(`${API_BASE_URL}/api/personalization`, () => HttpResponse.json(defaultPersonalization)));

    fireEvent.click(screen.getByRole("button", { name: "Borrar datos guardados" }));
    fireEvent.click(screen.getByRole("button", { name: "Limpiar" }));
    fireEvent.click(screen.getByRole("button", { name: "Sí, entiendo" }));
    fireEvent.click(screen.getByRole("button", { name: "Borrar personalización" }));

    await waitFor(() => expect(screen.getByLabelText("Apodo")).toHaveValue(""));
  });

  it("surfaces a 503 write failure honestly", async () => {
    server.use(
      http.delete(`${API_BASE_URL}/api/personalization`, () =>
        HttpResponse.json({ detail: "personalization_write_failed" }, { status: 503 })
      )
    );
    renderCard();
    await waitFor(() => expect(screen.getByLabelText("Apodo")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "Borrar datos guardados" }));
    fireEvent.click(screen.getByRole("button", { name: "Limpiar" }));
    fireEvent.click(screen.getByRole("button", { name: "Sí, entiendo" }));
    fireEvent.click(screen.getByRole("button", { name: "Borrar personalización" }));

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("personalization_write_failed"));
  });
});

describe("PersonalizationCard locale isolation (?locale=es vs ?locale=en) & dirty guard", () => {
  it("binds to backend active_locale even when UI locale differs (UI en + active_locale es reads/writes es)", async () => {
    const stores: Record<string, typeof defaultPersonalization> = {
      es: { ...defaultPersonalization, nickname: "TavoES" },
      en: { ...defaultPersonalization, nickname: "TavoEN" }
    };
    const getLocales: string[] = [];
    const putLocales: string[] = [];
    server.use(
      i18nStateHandler({ ...defaultI18nState, active_locale: "es", persisted_locale: "en", pending_restart: true }),
      http.get(`${API_BASE_URL}/api/personalization`, ({ request }) => {
        const loc = new URL(request.url).searchParams.get("locale") ?? "missing";
        getLocales.push(loc);
        return HttpResponse.json(stores[loc] ?? defaultPersonalization);
      }),
      http.put(`${API_BASE_URL}/api/personalization`, async ({ request }) => {
        const loc = new URL(request.url).searchParams.get("locale") ?? "missing";
        putLocales.push(loc);
        const body = (await request.json()) as Partial<typeof defaultPersonalization>;
        stores[loc] = { ...(stores[loc] ?? defaultPersonalization), ...body };
        return HttpResponse.json(stores[loc]);
      })
    );

    act(() => {
      useUiLocaleStore.setState({ locale: "en" });
    });

    renderCard();
    await waitFor(() => expect(screen.getByLabelText("Nickname")).toHaveValue("TavoES"));
    expect(getLocales).toEqual(["es"]);

    fireEvent.change(screen.getByLabelText("Nickname"), { target: { value: "EditedES" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(putLocales).toEqual(["es"]));
    expect(stores.es.nickname).toBe("EditedES");
    expect(stores.en.nickname).toBe("TavoEN");
  });

  it("switches to normalized en store when backend active_locale is en-US", async () => {
    const stores: Record<string, typeof defaultPersonalization> = {
      es: { ...defaultPersonalization, nickname: "TavoES" },
      en: { ...defaultPersonalization, nickname: "TavoEN" }
    };
    const putLocales: string[] = [];
    server.use(
      i18nStateHandler({ ...defaultI18nState, active_locale: "en-US", persisted_locale: "en-US" }),
      http.get(`${API_BASE_URL}/api/personalization`, ({ request }) => {
        const loc = new URL(request.url).searchParams.get("locale") ?? "missing";
        return HttpResponse.json(stores[loc] ?? defaultPersonalization);
      }),
      http.put(`${API_BASE_URL}/api/personalization`, async ({ request }) => {
        const loc = new URL(request.url).searchParams.get("locale") ?? "missing";
        putLocales.push(loc);
        const body = (await request.json()) as Partial<typeof defaultPersonalization>;
        stores[loc] = { ...(stores[loc] ?? defaultPersonalization), ...body };
        return HttpResponse.json(stores[loc]);
      })
    );

    renderCard();
    await waitFor(() => expect(screen.getByLabelText("Apodo")).toHaveValue("TavoEN"));

    fireEvent.change(screen.getByLabelText("Apodo"), { target: { value: "EnglishName" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));
    await waitFor(() => expect(putLocales).toEqual(["en"]));
    expect(stores.es.nickname).toBe("TavoES");
    expect(stores.en.nickname).toBe("EnglishName");
  });

  it("preserves unsaved form edits across background refetches while dirty, and syncs again after save", async () => {
    let serverData = { ...defaultPersonalization, nickname: "Initial" };
    server.use(
      http.get(`${API_BASE_URL}/api/personalization`, () => HttpResponse.json(serverData)),
      http.put(`${API_BASE_URL}/api/personalization`, async ({ request }) => {
        const body = (await request.json()) as Partial<typeof defaultPersonalization>;
        serverData = { ...serverData, ...body, updated_at: "2026-11-15T18:00:00Z" };
        return HttpResponse.json(serverData);
      })
    );

    const { queryClient } = renderCard();
    await waitFor(() => expect(screen.getByLabelText("Apodo")).toHaveValue("Initial"));

    fireEvent.change(screen.getByLabelText("Apodo"), { target: { value: "UnsavedTyping" } });
    serverData = { ...defaultPersonalization, nickname: "StaleBackgroundRefetch" };

    await act(async () => {
      await queryClient.invalidateQueries({ queryKey: ["personalization"] });
    });

    await waitFor(() => expect(screen.getByLabelText("Apodo")).toHaveValue("UnsavedTyping"));

    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));
    await waitFor(() => expect(serverData.nickname).toBe("UnsavedTyping"));

    serverData = { ...serverData, nickname: "FreshAfterSave" };
    await act(async () => {
      await queryClient.invalidateQueries({ queryKey: ["personalization"] });
    });
    await waitFor(() => expect(screen.getByLabelText("Apodo")).toHaveValue("FreshAfterSave"));
  });
});
