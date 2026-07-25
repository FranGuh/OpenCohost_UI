import { delay, http, HttpResponse } from "msw";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { server } from "../test/server.js";
import {
  API_BASE_URL,
  commandConflictHandler,
  commandNetworkErrorHandler,
  commandValidationHandler,
  defaultMemoriaImport,
  defaultMemoriaList,
  defaultMemoriaRows,
  defaultMemoriaStats,
  frozenStatusHandler,
  memoriaImportUnavailableHandler,
  memoriaRowNotFoundHandler,
  memoriaRowSpyHandler
} from "../test/handlers.js";
import { MemoryCard } from "./MemoryCard.js";

function renderCard() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(React.createElement(QueryClientProvider, { client: queryClient }, React.createElement(MemoryCard)));
}

// The Acciones and memoria-detail sections now persist their open state
// (oc-collapse-*). Clear between tests so a section opened in one case can't
// hydrate open in the next (the detail list starting closed is load-bearing:
// existing cases click "Ver" to open it).
beforeEach(() => {
  window.localStorage.clear();
});

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

describe("MemoryCard collapsible sections + textarea sizing", () => {
  it("keeps Acciones open by default and persists its toggle under memoria-actions", async () => {
    renderCard();
    const acciones = await screen.findByRole("button", { name: "Acciones" });
    expect(acciones).toHaveAttribute("aria-expanded", "true");

    fireEvent.click(acciones);
    expect(window.localStorage.getItem("oc-collapse-memoria-actions")).toBe("0");
  });

  it("persists the memoria detail list open state under memoria-list", async () => {
    renderCard();
    fireEvent.click(await screen.findByRole("button", { name: "Ver" }));
    expect(window.localStorage.getItem("oc-collapse-memoria-list")).toBe("1");
  });

  it("gives the import paste textarea the tall narrative clamp", async () => {
    renderCard();
    const paste = await screen.findByLabelText("Pegar memorias");
    expect(paste.className).toContain("min-h-[96px]");
    expect(paste.className).toContain("max-h-[240px]");
    expect(paste.className).toContain("resize-y");
  });

  it("keeps per-row memory expansion local and non-persisted (privacy: lazy fetch on open)", async () => {
    renderCard();
    fireEvent.click(await screen.findByRole("button", { name: "Ver" }));
    await waitFor(() => expect(screen.getByText("Título memoria A")).toBeInTheDocument());

    const [firstRow] = screen.getAllByRole("button", { name: "Ver memoria" });
    fireEvent.click(firstRow);
    await waitFor(() => expect(screen.getByText(defaultMemoriaRows.mem_a.content)).toBeInTheDocument());

    // Per-row expansion must NOT persist — it lazy-loads privacy-sensitive
    // detail on open, so a stored "open" would auto-refetch it on remount.
    const collapseKeys = Object.keys(window.localStorage).filter((k) => k.startsWith("oc-collapse-"));
    expect(collapseKeys.some((k) => k.includes("mem_a"))).toBe(false);
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

    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(screen.queryByText(/No se puede deshacer/)).not.toBeInTheDocument();
    expect(calls).toBe(0);

    // re-open and actually confirm this time (ack-gated advance)
    fireEvent.click(screen.getByRole("button", { name: "Limpiar memoria" }));
    fireEvent.click(screen.getByRole("button", { name: "Sí, entiendo" }));
    fireEvent.click(screen.getByRole("button", { name: "Limpiar memoria" }));
    await waitFor(() => expect(calls).toBe(1));
  });

  it("shows the danger message and gates the destructive advance on the acknowledgment", async () => {
    renderCard();

    fireEvent.click(await screen.findByRole("button", { name: "Limpiar memoria" }));

    expect(screen.getByText(/No se puede deshacer/)).toBeInTheDocument();
    // The advance (also "Limpiar memoria") stays disabled until "Sí, entiendo".
    expect(screen.getByRole("button", { name: "Limpiar memoria" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Sí, entiendo" }));
    expect(screen.getByRole("button", { name: "Limpiar memoria" })).toBeEnabled();
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
    fireEvent.click(screen.getByRole("button", { name: "Sí, entiendo" }));
    fireEvent.click(screen.getByRole("button", { name: "Limpiar memoria" }));
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
    fireEvent.click(screen.getByRole("button", { name: "Sí, entiendo" }));
    fireEvent.click(screen.getByRole("button", { name: "Limpiar memoria" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/conflict/));
  });

  it("shows a 422 validation alert", async () => {
    server.use(commandValidationHandler("unknown command"));
    renderCard();
    fireEvent.click(await screen.findByRole("button", { name: "Limpiar memoria" }));
    fireEvent.click(screen.getByRole("button", { name: "Sí, entiendo" }));
    fireEvent.click(screen.getByRole("button", { name: "Limpiar memoria" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("unknown command"));
  });

  it("shows a network-error alert", async () => {
    server.use(commandNetworkErrorHandler());
    renderCard();
    fireEvent.click(await screen.findByRole("button", { name: "Limpiar memoria" }));
    fireEvent.click(screen.getByRole("button", { name: "Sí, entiendo" }));
    fireEvent.click(screen.getByRole("button", { name: "Limpiar memoria" }));
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

  it("forwards active_profile_id (not the display name) as profile_id, so a correctly-keyed list renders", async () => {
    // Regression guard for the FIX-A break (da108a0): memoria rows are keyed by
    // the profile UUID, so MemoryCard must send `active_profile_id` as
    // profile_id. The default list handler ignores profile_id, which masks any
    // key mismatch; here we mirror the real backend's `WHERE profile_id = ?`,
    // so the rows appear ONLY when the correct UUID is forwarded — reverting to
    // the display name (or sending an empty id) would render the empty state.
    const activeId = "profile-uuid-under-test";
    server.use(frozenStatusHandler(1, { active_profile_id: activeId }));
    server.use(
      http.get(`${API_BASE_URL}/api/memoria/list`, ({ request }) => {
        const profileId = new URL(request.url).searchParams.get("profile_id");
        return HttpResponse.json({ items: profileId === activeId ? defaultMemoriaList.items : [] });
      })
    );
    renderCard();

    fireEvent.click(await screen.findByRole("button", { name: "Ver" }));
    await waitFor(() => expect(screen.getByText("Título memoria A")).toBeInTheDocument());
    expect(screen.getByText("Título memoria B")).toBeInTheDocument();
    // Not the empty state — the rows resolved because the right UUID was sent.
    expect(screen.queryByText(/Kira todavía no guardó memorias/)).not.toBeInTheDocument();
  });

  it("purges memorias through the three-stage confirm and empties the list", async () => {
    renderCard();
    fireEvent.click(await screen.findByRole("button", { name: "Ver" }));
    await waitFor(() => expect(screen.getByText("Título memoria A")).toBeInTheDocument());

    // Stage 1 opens the danger message; Cancelar backs fully out to the trigger.
    fireEvent.click(screen.getByRole("button", { name: "Purgar memorias" }));
    expect(screen.getByText(/No se puede deshacer/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(screen.getByText("Título memoria A")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Purgar memorias" })).toBeInTheDocument();

    // Re-open and walk all three stages: message -> acknowledge -> final purge.
    fireEvent.click(screen.getByRole("button", { name: "Purgar memorias" }));
    fireEvent.click(screen.getByRole("button", { name: "Continuar" }));
    fireEvent.click(screen.getByRole("button", { name: "Sí, entiendo" }));
    fireEvent.click(screen.getByRole("button", { name: "Continuar" }));
    fireEvent.click(screen.getByRole("button", { name: "Purgar definitivamente" }));

    await waitFor(() => expect(screen.getByText(/Kira todavía no guardó memorias/)).toBeInTheDocument());
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
    expect(screen.queryByText(/Kira todavía no guardó memorias/)).not.toBeInTheDocument();
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
    fireEvent.click(screen.getByRole("button", { name: "Eliminar memoria" }));

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

describe("MemoryCard import section (WU4)", () => {
  it("keeps the import submit disabled until there is content, then enables it", async () => {
    renderCard();
    const trigger = await screen.findByRole("button", { name: "Importar memorias" });
    expect(trigger).toBeDisabled();

    fireEvent.change(screen.getByLabelText("Pegar memorias"), { target: { value: "* una memoria" } });
    // Enables once BOTH content is present AND the active profile has loaded.
    await waitFor(() => expect(screen.getByRole("button", { name: "Importar memorias" })).toBeEnabled());
  });

  it("gates the import behind a single confirm — no request until confirmed, then posts label+content and shows the counts", async () => {
    let body: unknown;
    server.use(
      http.post(`${API_BASE_URL}/api/memoria/import`, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json(defaultMemoriaImport);
      })
    );
    renderCard();
    await screen.findByRole("button", { name: "Importar memorias" });
    fireEvent.change(screen.getByLabelText("Pegar memorias"), { target: { value: "* una memoria" } });
    await waitFor(() => expect(screen.getByRole("button", { name: "Importar memorias" })).toBeEnabled());

    // Opening the confirm must NOT send anything yet (always-confirm gate).
    fireEvent.click(screen.getByRole("button", { name: "Importar memorias" }));
    expect(body).toBeUndefined();
    expect(screen.getByText(/Vas a importar memorias/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Importar" }));
    await waitFor(() =>
      expect(body).toEqual({ profile_id: "profile-id-default", source_label: "Gemini", content: "* una memoria" })
    );

    // Real counts, voseo — the default fixture has skipped_cap:0 so "sin cupo" is absent.
    await waitFor(() => expect(screen.getByText(/Se importaron 3/)).toBeInTheDocument());
    expect(screen.getByText(/1 duplicada/)).toBeInTheDocument();
    expect(screen.getByText(/2 muy cortas/)).toBeInTheDocument();
    expect(screen.queryByText(/sin cupo/)).not.toBeInTheDocument();
  });

  it("Cancelar backs out of the confirm without sending", async () => {
    let calls = 0;
    server.use(
      http.post(`${API_BASE_URL}/api/memoria/import`, () => {
        calls += 1;
        return HttpResponse.json(defaultMemoriaImport);
      })
    );
    renderCard();
    await screen.findByRole("button", { name: "Importar memorias" });
    fireEvent.change(screen.getByLabelText("Pegar memorias"), { target: { value: "* una memoria" } });
    await waitFor(() => expect(screen.getByRole("button", { name: "Importar memorias" })).toBeEnabled());

    fireEvent.click(screen.getByRole("button", { name: "Importar memorias" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(screen.queryByText(/Vas a importar memorias/)).not.toBeInTheDocument();
    expect(calls).toBe(0);
  });

  it("renders every real count in voseo, including skipped_cap and failed when nonzero", async () => {
    server.use(
      http.post(`${API_BASE_URL}/api/memoria/import`, () =>
        HttpResponse.json({ ok: false, imported: 4, skipped_duplicates: 2, skipped_too_short: 1, skipped_cap: 3, failed: 5 })
      )
    );
    renderCard();
    await screen.findByRole("button", { name: "Importar memorias" });
    fireEvent.change(screen.getByLabelText("Pegar memorias"), { target: { value: "* una memoria" } });
    await waitFor(() => expect(screen.getByRole("button", { name: "Importar memorias" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Importar memorias" }));
    fireEvent.click(screen.getByRole("button", { name: "Importar" }));

    await waitFor(() => expect(screen.getByText(/Se importaron 4/)).toBeInTheDocument());
    expect(screen.getByText(/2 duplicadas/)).toBeInTheDocument();
    expect(screen.getByText(/1 muy corta/)).toBeInTheDocument();
    expect(screen.getByText(/3 sin cupo/)).toBeInTheDocument();
    expect(screen.getByText(/5 con error/)).toBeInTheDocument();
  });

  it("surfaces a 503 backend error honestly instead of a fake success line", async () => {
    server.use(memoriaImportUnavailableHandler());
    renderCard();
    await screen.findByRole("button", { name: "Importar memorias" });
    fireEvent.change(screen.getByLabelText("Pegar memorias"), { target: { value: "* una memoria" } });
    await waitFor(() => expect(screen.getByRole("button", { name: "Importar memorias" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Importar memorias" }));
    fireEvent.click(screen.getByRole("button", { name: "Importar" }));

    await waitFor(() => expect(screen.getByText(/no está disponible/i)).toBeInTheDocument());
    expect(screen.queryByText(/Se importaron/)).not.toBeInTheDocument();
  });

  it("prompts to activate a profile instead of leaving a silently disabled submit", async () => {
    // FIX 5: no active profile -> the sibling prompt (mirrors the row list's
    // null-profile branch), never a mute disabled button.
    server.use(frozenStatusHandler(1, { active_profile_id: null }));
    renderCard();
    expect(await screen.findByText(/Activá un perfil para importar memorias/)).toBeInTheDocument();
    // The form + submit are replaced by the prompt, not left silently disabled.
    expect(screen.queryByRole("button", { name: "Importar memorias" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Pegar memorias")).not.toBeInTheDocument();
  });

  it("warns when the pasted content is larger than 64 KB and keeps submit disabled (the backend would 422 it)", async () => {
    renderCard();
    const big = "x".repeat(65_537);
    fireEvent.change(await screen.findByLabelText("Pegar memorias"), { target: { value: big } });
    expect(screen.getByText(/64 KB/)).toBeInTheDocument();
    // FIX 1: an oversize paste must not be submittable either.
    expect(screen.getByRole("button", { name: "Importar memorias" })).toBeDisabled();
  });

  it("rejects an oversize file before reading it — message shown, no content set, submit disabled", async () => {
    // FIX 1: file.size is checked BEFORE readAsText, so an oversize file never
    // populates the content field (no read) and stays unsubmittable.
    renderCard();
    const fileInput = await screen.findByLabelText("Archivo de memorias");
    const big = new File(["x".repeat(65_537)], "big.md", { type: "text/markdown" });
    fireEvent.change(fileInput, { target: { files: [big] } });

    expect(screen.getByText(/El archivo pesa más de 64 KB/)).toBeInTheDocument();
    // Never read into the paste field.
    expect(screen.getByLabelText("Pegar memorias")).toHaveValue("");
    expect(screen.getByRole("button", { name: "Importar memorias" })).toBeDisabled();
  });

  it("shows a kind message when the file cannot be read (FileReader onerror)", async () => {
    // FIX 3: force readAsText to fail — the section surfaces a kind voseo message
    // and never leaks partial content into the paste field.
    class ErroringFileReader {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      readAsText() {
        this.onerror?.();
      }
    }
    vi.stubGlobal("FileReader", ErroringFileReader);
    try {
      renderCard();
      const fileInput = await screen.findByLabelText("Archivo de memorias");
      const file = new File(["* algo"], "export.md", { type: "text/markdown" });
      fireEvent.change(fileInput, { target: { files: [file] } });

      expect(screen.getByText(/No se pudo leer el archivo/)).toBeInTheDocument();
      expect(screen.getByLabelText("Pegar memorias")).toHaveValue("");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("uses singular copy when a count is exactly 1 (FIX 4)", async () => {
    server.use(
      http.post(`${API_BASE_URL}/api/memoria/import`, () =>
        HttpResponse.json({ ok: true, imported: 1, skipped_duplicates: 1, skipped_too_short: 1, skipped_cap: 0, failed: 0 })
      )
    );
    renderCard();
    await screen.findByRole("button", { name: "Importar memorias" });
    fireEvent.change(screen.getByLabelText("Pegar memorias"), { target: { value: "* una memoria" } });
    await waitFor(() => expect(screen.getByRole("button", { name: "Importar memorias" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Importar memorias" }));
    fireEvent.click(screen.getByRole("button", { name: "Importar" }));

    await waitFor(() => expect(screen.getByText(/Se importó 1/)).toBeInTheDocument());
    expect(screen.getByText(/1 duplicada\b/)).toBeInTheDocument();
    expect(screen.getByText(/1 muy corta\b/)).toBeInTheDocument();
    // ...and never the plural forms.
    expect(screen.queryByText(/Se importaron/)).not.toBeInTheDocument();
    expect(screen.queryByText(/duplicadas/)).not.toBeInTheDocument();
    expect(screen.queryByText(/muy cortas/)).not.toBeInTheDocument();
  });

  it("clears the textarea after success and drops the stale result line on the next import (FIX 6)", async () => {
    renderCard();
    await screen.findByRole("button", { name: "Importar memorias" });

    // First import → success (default fixture: imported 3).
    fireEvent.change(screen.getByLabelText("Pegar memorias"), { target: { value: "* primera" } });
    await waitFor(() => expect(screen.getByRole("button", { name: "Importar memorias" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Importar memorias" }));
    fireEvent.click(screen.getByRole("button", { name: "Importar" }));
    await waitFor(() => expect(screen.getByText(/Se importaron 3/)).toBeInTheDocument());

    // Post-success hygiene: the textarea is emptied so it can't be resubmitted.
    expect(screen.getByLabelText("Pegar memorias")).toHaveValue("");

    // Second import: opening the confirm resets the mutation, so the prior count
    // line is gone before the next request even fires (no stale counts).
    fireEvent.change(screen.getByLabelText("Pegar memorias"), { target: { value: "* segunda" } });
    await waitFor(() => expect(screen.getByRole("button", { name: "Importar memorias" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Importar memorias" }));
    expect(screen.queryByText(/Se importaron 3/)).not.toBeInTheDocument();
  });

  it("shows an explicit Importando… state while the request is in flight (FIX 7)", async () => {
    server.use(
      http.post(`${API_BASE_URL}/api/memoria/import`, async () => {
        await delay(40);
        return HttpResponse.json(defaultMemoriaImport);
      })
    );
    renderCard();
    await screen.findByRole("button", { name: "Importar memorias" });
    fireEvent.change(screen.getByLabelText("Pegar memorias"), { target: { value: "* una memoria" } });
    await waitFor(() => expect(screen.getByRole("button", { name: "Importar memorias" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Importar memorias" }));
    fireEvent.click(screen.getByRole("button", { name: "Importar" }));

    // Working state is explicit, distinct from an incomplete-form disabled button.
    expect(await screen.findByText("Importando…")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText(/Se importaron 3/)).toBeInTheDocument());
    expect(screen.queryByText("Importando…")).not.toBeInTheDocument();
  });

  it("maps a 404 import to a kind 'backend does not have this yet' message (FIX 8)", async () => {
    server.use(
      http.post(`${API_BASE_URL}/api/memoria/import`, () => HttpResponse.json({ detail: "not found" }, { status: 404 }))
    );
    renderCard();
    await screen.findByRole("button", { name: "Importar memorias" });
    fireEvent.change(screen.getByLabelText("Pegar memorias"), { target: { value: "* una memoria" } });
    await waitFor(() => expect(screen.getByRole("button", { name: "Importar memorias" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Importar memorias" }));
    fireEvent.click(screen.getByRole("button", { name: "Importar" }));

    await waitFor(() => expect(screen.getByText(/no tiene esta función todavía/)).toBeInTheDocument());
    expect(screen.queryByText(/Se importaron/)).not.toBeInTheDocument();
  });

  it("maps a network failure to a kind 'no backend connection' message (FIX 8)", async () => {
    server.use(http.post(`${API_BASE_URL}/api/memoria/import`, () => HttpResponse.error()));
    renderCard();
    await screen.findByRole("button", { name: "Importar memorias" });
    fireEvent.change(screen.getByLabelText("Pegar memorias"), { target: { value: "* una memoria" } });
    await waitFor(() => expect(screen.getByRole("button", { name: "Importar memorias" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Importar memorias" }));
    fireEvent.click(screen.getByRole("button", { name: "Importar" }));

    await waitFor(() => expect(screen.getByText(/No hay conexión con el backend/)).toBeInTheDocument());
    expect(screen.queryByText(/Se importaron/)).not.toBeInTheDocument();
  });

  it("uses the free-text label when the source is Otro", async () => {
    let body: unknown;
    server.use(
      http.post(`${API_BASE_URL}/api/memoria/import`, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json(defaultMemoriaImport);
      })
    );
    renderCard();
    fireEvent.click(await screen.findByRole("combobox", { name: "Origen de las memorias" }));
    fireEvent.click(screen.getByRole("option", { name: "Otro" }));
    fireEvent.change(screen.getByLabelText("Nombre del origen"), { target: { value: "Claude" } });
    fireEvent.change(screen.getByLabelText("Pegar memorias"), { target: { value: "* una memoria" } });
    await waitFor(() => expect(screen.getByRole("button", { name: "Importar memorias" })).toBeEnabled());

    fireEvent.click(screen.getByRole("button", { name: "Importar memorias" }));
    fireEvent.click(screen.getByRole("button", { name: "Importar" }));
    await waitFor(() => expect(body).toMatchObject({ source_label: "Claude", content: "* una memoria" }));
  });

  it("reads an uploaded .md/.txt file into the same content field", async () => {
    renderCard();
    const fileInput = await screen.findByLabelText("Archivo de memorias");
    const file = new File(["* desde un archivo"], "export.md", { type: "text/markdown" });
    fireEvent.change(fileInput, { target: { files: [file] } });

    await waitFor(() => expect(screen.getByLabelText("Pegar memorias")).toHaveValue("* desde un archivo"));
  });
});

describe("MemoryCard importada badge (WU4)", () => {
  function listWith(items: Array<Record<string, unknown>>) {
    return http.get(`${API_BASE_URL}/api/memoria/list`, () => HttpResponse.json({ items }));
  }

  it("renders the 'importada' badge only for rows with imported:true", async () => {
    server.use(
      listWith([
        {
          id: "mem_imp",
          title: "Memoria importada",
          created_at: "2026-01-01T00:00:00+00:00",
          updated_at: "2026-01-01T00:00:00+00:00",
          revision: 1,
          pinned: false,
          private: false,
          inactive: false,
          imported: true
        },
        {
          id: "mem_cur",
          title: "Memoria curada",
          created_at: "2026-01-02T00:00:00+00:00",
          updated_at: "2026-01-02T00:00:00+00:00",
          revision: 1,
          pinned: false,
          private: false,
          inactive: false,
          imported: false
        }
      ])
    );
    renderCard();
    fireEvent.click(await screen.findByRole("button", { name: "Ver" }));
    await waitFor(() => expect(screen.getByText("Memoria importada")).toBeInTheDocument());

    expect(screen.getByText("Memoria curada")).toBeInTheDocument();
    // Exactly one row carries the badge — the curated row has none.
    expect(screen.getAllByText("importada")).toHaveLength(1);
  });
});

describe("MemoryCard draft visibility (WU-D)", () => {
  function listWith(items: Array<Record<string, unknown>>) {
    return http.get(`${API_BASE_URL}/api/memoria/list`, () => HttpResponse.json({ items }));
  }

  it("marks a draft row as provisional and leaves a curated row unmarked", async () => {
    server.use(
      listWith([
        {
          id: "mem_draft",
          title: "Memoria en borrador",
          created_at: "2026-01-01T00:00:00+00:00",
          updated_at: "2026-01-01T00:00:00+00:00",
          revision: 1,
          pinned: false,
          private: false,
          inactive: false,
          imported: false,
          draft: true
        },
        {
          id: "mem_curated",
          title: "Memoria curada",
          created_at: "2026-01-02T00:00:00+00:00",
          updated_at: "2026-01-02T00:00:00+00:00",
          revision: 1,
          pinned: false,
          private: false,
          inactive: false,
          imported: false,
          draft: false
        }
      ])
    );
    renderCard();
    fireEvent.click(await screen.findByRole("button", { name: "Ver" }));
    await waitFor(() => expect(screen.getByText("Memoria en borrador")).toBeInTheDocument());

    expect(screen.getByText("Memoria curada")).toBeInTheDocument();
    // Exactly one row carries the "borrador" badge — the curated row has none.
    expect(screen.getAllByText("borrador")).toHaveLength(1);
  });
});

describe("MemoryCard memoria list — provenance filter chips (Ticket C)", () => {
  function listWith(items: Array<Record<string, unknown>>) {
    return http.get(`${API_BASE_URL}/api/memoria/list`, () => HttpResponse.json({ items }));
  }

  const mixedItems = [
    {
      id: "mem_native",
      title: "Memoria propia",
      created_at: "2026-01-01T00:00:00+00:00",
      updated_at: "2026-01-01T00:00:00+00:00",
      revision: 1,
      pinned: false,
      private: false,
      inactive: false,
      imported: false
    },
    {
      id: "mem_imported",
      title: "Memoria importada",
      created_at: "2026-01-02T00:00:00+00:00",
      updated_at: "2026-01-02T00:00:00+00:00",
      revision: 1,
      pinned: false,
      private: false,
      inactive: false,
      imported: true
    }
  ];

  it("defaults to 'Todas' and shows every row", async () => {
    server.use(listWith(mixedItems));
    renderCard();
    fireEvent.click(await screen.findByRole("button", { name: "Ver" }));
    await waitFor(() => expect(screen.getByText("Memoria propia")).toBeInTheDocument());
    expect(screen.getByText("Memoria importada")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Todas" })).toHaveAttribute("aria-pressed", "true");
  });

  it("'Importadas' chip filters to only imported:true rows", async () => {
    server.use(listWith(mixedItems));
    renderCard();
    fireEvent.click(await screen.findByRole("button", { name: "Ver" }));
    await waitFor(() => expect(screen.getByText("Memoria propia")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "Importadas" }));
    expect(screen.getByText("Memoria importada")).toBeInTheDocument();
    expect(screen.queryByText("Memoria propia")).not.toBeInTheDocument();
  });

  it("'Propias' chip filters to only imported:false rows", async () => {
    server.use(listWith(mixedItems));
    renderCard();
    fireEvent.click(await screen.findByRole("button", { name: "Ver" }));
    await waitFor(() => expect(screen.getByText("Memoria propia")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "Propias" }));
    expect(screen.getByText("Memoria propia")).toBeInTheDocument();
    expect(screen.queryByText("Memoria importada")).not.toBeInTheDocument();
  });

  it("shows 'No hay memorias de este tipo.' when a chip filters out every row", async () => {
    server.use(listWith([mixedItems[0]]));
    renderCard();
    fireEvent.click(await screen.findByRole("button", { name: "Ver" }));
    await waitFor(() => expect(screen.getByText("Memoria propia")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "Importadas" }));
    expect(await screen.findByText("No hay memorias de este tipo.")).toBeInTheDocument();
    expect(screen.queryByText("Memoria propia")).not.toBeInTheDocument();
  });

  it("does not render chips when the list is empty, and existing empty-state copy stays intact", async () => {
    server.use(listWith([]));
    renderCard();
    fireEvent.click(await screen.findByRole("button", { name: "Ver" }));
    await waitFor(() => expect(screen.getByText(/Kira todavía no guardó memorias/)).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: "Todas" })).not.toBeInTheDocument();
  });

  it("chips coexist with existing per-row actions — badges and purge flow still work with 'Todas' selected", async () => {
    renderCard(); // default fixture (defaultMemoriaList — both rows imported:false)
    fireEvent.click(await screen.findByRole("button", { name: "Ver" }));
    await waitFor(() => expect(screen.getByText("Título memoria A")).toBeInTheDocument());
    expect(screen.getByText("fijada")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Purgar memorias" })).toBeInTheDocument();
  });
});
