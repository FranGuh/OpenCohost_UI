import { http, HttpResponse } from "msw";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { beforeEach, describe, expect, it } from "vitest";
import { server } from "../../test/server.js";
import { API_BASE_URL, defaultPersonalization } from "../../test/handlers.js";
import { PersonalizationCard } from "./PersonalizationCard.js";

// Collapse state persists to localStorage (oc-collapse-*); clear between tests
// so the default-closed destructive section can't leak an opened state forward.
beforeEach(() => {
  window.localStorage.clear();
});

function renderCard() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    React.createElement(QueryClientProvider, { client: queryClient }, React.createElement(PersonalizationCard))
  );
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
