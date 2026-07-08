import { http, HttpResponse } from "msw";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { describe, expect, it } from "vitest";
import { server } from "../test/server.js";
import {
  API_BASE_URL,
  commandConflictHandler,
  commandNetworkErrorHandler,
  commandValidationHandler,
  defaultMemoriaRows,
  defaultMemoriaStats,
  frozenStatusHandler,
  memoriaRowNotFoundHandler,
  memoriaRowSpyHandler
} from "../test/handlers.js";
import { MemoryCard } from "./MemoryCard.js";

function renderCard() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(React.createElement(QueryClientProvider, { client: queryClient }, React.createElement(MemoryCard)));
}

describe("MemoryCard populates from GET /api/memoria/stats", () => {
  it("renders the counts-only inspector with no raw chat content", async () => {
    renderCard();
    await waitFor(() => expect(screen.getByText("14")).toBeInTheDocument());
    expect(screen.getByText(/solo conteos/)).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
    expect(screen.getByText("7")).toBeInTheDocument();
    expect(screen.getByText("5")).toBeInTheDocument();
  });

  it("surfaces a GET error honestly instead of a stale/hardcoded count list", async () => {
    server.use(
      http.get(`${API_BASE_URL}/api/memoria/stats`, () => HttpResponse.json({ detail: "boom" }, { status: 500 }))
    );
    renderCard();
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
  });
});

describe("MemoryCard Limpiar memoria — confirm step", () => {
  it("requires a confirm step before dispatching, and Cancelar backs out without dispatching", async () => {
    let calls = 0;
    server.use(
      http.post(`${API_BASE_URL}/api/commands`, () => {
        calls += 1;
        return HttpResponse.json({ accepted: true, command_id: "cmd-1", status: "queued", state_version: 2 });
      })
    );
    renderCard();

    fireEvent.click(await screen.findByRole("button", { name: "Limpiar memoria" }));
    expect(screen.getByText(/No se puede deshacer/)).toBeInTheDocument();
    const confirmButton = screen.getByRole("button", { name: "Confirmar" });

    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(screen.queryByRole("button", { name: "Confirmar" })).not.toBeInTheDocument();
    expect(calls).toBe(0);

    // re-open and actually confirm this time
    fireEvent.click(screen.getByRole("button", { name: "Limpiar memoria" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirmar" }));
    expect(confirmButton).toBeTruthy();
    await waitFor(() => expect(calls).toBe(1));
  });

  it("announces the destructive confirm prompt via role=alert and moves focus to Confirmar", async () => {
    renderCard();

    fireEvent.click(await screen.findByRole("button", { name: "Limpiar memoria" }));

    expect(screen.getByRole("alert")).toHaveTextContent(/No se puede deshacer/);
    expect(screen.getByRole("button", { name: "Confirmar" })).toHaveFocus();
  });

  it("dispatches clear_history with no payload value on confirm — accepted -> poll -> applied", async () => {
    // state_version pinned — never advances independently of a subsequent
    // POST; convergence must come from the optimistic timer, not this.
    server.use(frozenStatusHandler(1));
    let capturedBody: unknown;
    server.use(
      http.post(`${API_BASE_URL}/api/commands`, async ({ request }) => {
        capturedBody = await request.json();
        return HttpResponse.json({ accepted: true, command_id: "cmd-clear", status: "queued", state_version: 1 });
      })
    );
    renderCard();

    fireEvent.click(await screen.findByRole("button", { name: "Limpiar memoria" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirmar" }));
    expect(screen.getByText("aplicando…")).toBeInTheDocument();

    await waitFor(() => expect(capturedBody).toEqual({ command: "clear_history", payload: {} }));
    await waitFor(() => expect(screen.queryByText("aplicando…")).not.toBeInTheDocument());
  });
});

describe("MemoryCard clear_history errors surface honestly", () => {
  it("shows a 409 conflict alert", async () => {
    server.use(commandConflictHandler());
    renderCard();
    fireEvent.click(await screen.findByRole("button", { name: "Limpiar memoria" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirmar" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/conflict/));
  });

  it("shows a 422 validation alert", async () => {
    server.use(commandValidationHandler("unknown command"));
    renderCard();
    fireEvent.click(await screen.findByRole("button", { name: "Limpiar memoria" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirmar" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("unknown command"));
  });

  it("shows a network-error alert", async () => {
    server.use(commandNetworkErrorHandler());
    renderCard();
    fireEvent.click(await screen.findByRole("button", { name: "Limpiar memoria" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirmar" }));
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
  });
});

describe("MemoryCard memoria row list + purge (F5)", () => {
  it("renders the per-row list from GET /api/memoria/list on demand, with no content leak", async () => {
    renderCard();
    fireEvent.click(await screen.findByRole("button", { name: "Ver" }));
    await waitFor(() => expect(screen.getByText("Título memoria A")).toBeInTheDocument());
    expect(screen.getByText("Título memoria B")).toBeInTheDocument();
    expect(screen.getByText("fijada")).toBeInTheDocument();
    expect(screen.getByText("privada")).toBeInTheDocument();
    // Content is a per-row on-demand fetch — never rendered from the list alone.
    expect(screen.queryByText(defaultMemoriaRows.mem_a.content)).not.toBeInTheDocument();
  });

  it("purges memorias through the confirm/cancel pattern and empties the list", async () => {
    renderCard();
    fireEvent.click(await screen.findByRole("button", { name: "Ver" }));
    await waitFor(() => expect(screen.getByText("Título memoria A")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "Purgar memorias" }));
    expect(screen.getByText(/No se puede deshacer/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(screen.getByText("Título memoria A")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Purgar memorias" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirmar" }));

    await waitFor(() => expect(screen.getByText(/No hay memorias guardadas/)).toBeInTheDocument());
  });

  it("surfaces a GET /api/memoria/list error honestly", async () => {
    server.use(
      http.get(`${API_BASE_URL}/api/memoria/list`, () => HttpResponse.json({ detail: "boom" }, { status: 500 }))
    );
    renderCard();
    fireEvent.click(await screen.findByRole("button", { name: "Ver" }));
    await waitFor(() => expect(screen.getByText(/No se pudo leer el detalle/)).toBeInTheDocument());
  });

  it("degrades gracefully (disabled purge, no request) when active_profile_id is null", async () => {
    server.use(frozenStatusHandler(1, { active_profile_id: null }));
    let listRequested = false;
    server.use(
      http.get(`${API_BASE_URL}/api/memoria/list`, () => {
        listRequested = true;
        return HttpResponse.json({ items: [] });
      })
    );
    renderCard();
    fireEvent.click(await screen.findByRole("button", { name: "Ver" }));

    expect(screen.getByRole("button", { name: "Purgar memorias" })).toBeDisabled();
    expect(listRequested).toBe(false);
  });

  it("explains why the list is empty (not a silent blank) when active_profile_id is null", async () => {
    server.use(frozenStatusHandler(1, { active_profile_id: null }));
    renderCard();
    fireEvent.click(await screen.findByRole("button", { name: "Ver" }));

    expect(await screen.findByText(/Activá un perfil para ver sus memorias/)).toBeInTheDocument();
    // The null branch replaces both the empty-state message and any rows.
    expect(screen.queryByText(/No hay memorias guardadas/)).not.toBeInTheDocument();
  });
});

describe("MemoryCard per-profile counts (FIX-A)", () => {
  it("headline count shows the per-profile figure, never the global total", async () => {
    server.use(
      http.get(`${API_BASE_URL}/api/memoria/stats`, () =>
        HttpResponse.json({
          ...defaultMemoriaStats,
          saved_memorias: 4,
          pinned: 6,
          saved_memorias_total: 99,
          pinned_total: 50
        })
      )
    );
    renderCard();

    // Per-profile saved/pinned are rendered as headline counts...
    await waitFor(() => expect(screen.getByText("4")).toBeInTheDocument());
    expect(screen.getByText("6")).toBeInTheDocument();
    // ...and the global totals are NOT surfaced as headline counts.
    expect(screen.queryByText("99")).not.toBeInTheDocument();
    expect(screen.queryByText("50")).not.toBeInTheDocument();
  });

  it("requests stats scoped to the active profile id", async () => {
    server.use(frozenStatusHandler(1, { active_profile_id: "30ea444e-akira" }));
    let capturedUrl: string | null = null;
    server.use(
      http.get(`${API_BASE_URL}/api/memoria/stats`, ({ request }) => {
        capturedUrl = request.url;
        return HttpResponse.json(defaultMemoriaStats);
      })
    );
    renderCard();

    await waitFor(() => expect(capturedUrl).toContain("profile_id=30ea444e-akira"));
  });
});

describe("MemoryCard per-row content — on-demand load (WU-H, operator viewing decision)", () => {
  it("never hits GET /api/memoria/row while the list renders — content loads only on explicit click", async () => {
    const counter = { calls: 0 };
    server.use(memoriaRowSpyHandler(counter));

    renderCard();
    fireEvent.click(await screen.findByRole("button", { name: "Ver" }));
    await waitFor(() => expect(screen.getByText("Título memoria A")).toBeInTheDocument());

    expect(counter.calls).toBe(0);
  });

  it('clicking "Ver memoria" fetches and shows the row content, then "Ocultar" collapses it', async () => {
    renderCard();
    fireEvent.click(await screen.findByRole("button", { name: "Ver" }));
    await waitFor(() => expect(screen.getByText("Título memoria A")).toBeInTheDocument());

    const [firstRowButton] = screen.getAllByRole("button", { name: "Ver memoria" });
    fireEvent.click(firstRowButton);

    await waitFor(() => expect(screen.getByText(defaultMemoriaRows.mem_a.content)).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "Ocultar memoria" }));
    expect(screen.queryByText(defaultMemoriaRows.mem_a.content)).not.toBeInTheDocument();
  });

  it("surfaces a 404 from GET /api/memoria/row honestly instead of silently showing nothing", async () => {
    server.use(memoriaRowNotFoundHandler());
    renderCard();
    fireEvent.click(await screen.findByRole("button", { name: "Ver" }));
    await waitFor(() => expect(screen.getByText("Título memoria A")).toBeInTheDocument());

    const [firstRowButton] = screen.getAllByRole("button", { name: "Ver memoria" });
    fireEvent.click(firstRowButton);

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("memoria not found"));
  });
});

describe("MemoryCard redesigned memoria cards (WU2)", () => {
  function listWith(items: Array<Record<string, unknown>>) {
    return http.get(`${API_BASE_URL}/api/memoria/list`, () => HttpResponse.json({ items }));
  }

  it("renders pinned (info), private (neutral) and inactive (warn) badges per card", async () => {
    server.use(
      listWith([
        {
          id: "mem_a",
          title: "Título memoria A",
          created_at: "2026-01-01T00:00:00+00:00",
          updated_at: "2026-01-01T00:00:00+00:00",
          revision: 1,
          pinned: true,
          private: true,
          inactive: true
        }
      ])
    );
    renderCard();
    fireEvent.click(await screen.findByRole("button", { name: "Ver" }));
    await waitFor(() => expect(screen.getByText("Título memoria A")).toBeInTheDocument());

    expect(screen.getByText("fijada")).toBeInTheDocument();
    expect(screen.getByText("privada")).toBeInTheDocument();
    // inactive was projected in the list item but unrendered before WU2.
    expect(screen.getByText("inactiva")).toBeInTheDocument();
  });

  it("toggling pin calls POST /api/memoria/flags with the inverted flag and the row id", async () => {
    let body: unknown;
    server.use(
      http.post(`${API_BASE_URL}/api/memoria/flags`, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ ok: true });
      })
    );
    renderCard();
    fireEvent.click(await screen.findByRole("button", { name: "Ver" }));
    await waitFor(() => expect(screen.getByText("Título memoria A")).toBeInTheDocument());

    // mem_a is pinned -> its toggle reads "Desfijar" and un-pins on click.
    const [unpin] = screen.getAllByRole("button", { name: "Desfijar" });
    fireEvent.click(unpin);

    await waitFor(() =>
      expect(body).toEqual({ profile_id: "profile-id-default", id: "mem_a", pinned: false })
    );
  });

  it("deleting a card is two-step and calls POST /api/memoria/delete on confirm", async () => {
    let body: unknown;
    server.use(
      http.post(`${API_BASE_URL}/api/memoria/delete`, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ ok: true });
      })
    );
    renderCard();
    fireEvent.click(await screen.findByRole("button", { name: "Ver" }));
    await waitFor(() => expect(screen.getByText("Título memoria A")).toBeInTheDocument());

    const [del] = screen.getAllByRole("button", { name: "Eliminar" });
    fireEvent.click(del);
    // No request until the confirm step.
    expect(body).toBeUndefined();
    fireEvent.click(screen.getByRole("button", { name: "Confirmar" }));

    await waitFor(() => expect(body).toEqual({ profile_id: "profile-id-default", id: "mem_a" }));
  });

  it("editing a card lazy-loads content then calls POST /api/memoria/update with title+content", async () => {
    let body: unknown;
    server.use(
      http.post(`${API_BASE_URL}/api/memoria/update`, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ ok: true });
      })
    );
    renderCard();
    fireEvent.click(await screen.findByRole("button", { name: "Ver" }));
    await waitFor(() => expect(screen.getByText("Título memoria A")).toBeInTheDocument());

    const [edit] = screen.getAllByRole("button", { name: "Editar" });
    fireEvent.click(edit);
    // R8: content is fetched only on this explicit edit click, then prefilled.
    await waitFor(() =>
      expect(screen.getByLabelText("Contenido de la memoria")).toHaveValue(defaultMemoriaRows.mem_a.content)
    );

    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));

    await waitFor(() =>
      expect(body).toEqual({
        profile_id: "profile-id-default",
        id: "mem_a",
        title: "Título memoria A",
        content: defaultMemoriaRows.mem_a.content
      })
    );
  });

  it("re-editing a saved row shows the just-saved content, not the stale cached row (no silent revert)", async () => {
    // Reproduces the stale-row-cache bug: useMemoriaRowQuery is enabled:false,
    // so an update that only invalidates the list leaves the row cache holding
    // pre-edit content. startEdit reads that cache (and skips refetch because
    // data is truthy), so a second edit of the same row would seed the OLD
    // content and silently revert the prior save. The update mutation must
    // write the saved title/content back into the row cache.
    server.use(http.post(`${API_BASE_URL}/api/memoria/update`, () => HttpResponse.json({ ok: true })));

    renderCard();
    fireEvent.click(await screen.findByRole("button", { name: "Ver" }));
    await waitFor(() => expect(screen.getByText("Título memoria A")).toBeInTheDocument());

    // First edit: lazy-load content, replace it, save.
    fireEvent.click(screen.getAllByRole("button", { name: "Editar" })[0]);
    await waitFor(() =>
      expect(screen.getByLabelText("Contenido de la memoria")).toHaveValue(defaultMemoriaRows.mem_a.content)
    );
    const edited = "Contenido editado por el operador.";
    fireEvent.change(screen.getByLabelText("Contenido de la memoria"), { target: { value: edited } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));

    // Form closes on success.
    await waitFor(() => expect(screen.queryByRole("button", { name: "Guardar" })).not.toBeInTheDocument());

    // Second edit of the SAME row must show the saved content, not the stale original.
    fireEvent.click(screen.getAllByRole("button", { name: "Editar" })[0]);
    await waitFor(() => expect(screen.getByLabelText("Contenido de la memoria")).toHaveValue(edited));
    expect(screen.getByLabelText("Contenido de la memoria")).not.toHaveValue(defaultMemoriaRows.mem_a.content);
  });
});
