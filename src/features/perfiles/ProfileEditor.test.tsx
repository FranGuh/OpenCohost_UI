import { http, HttpResponse } from "msw";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import React, { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { server } from "../../test/server.js";
import {
  API_BASE_URL,
  createPerfilConflictHandler,
  defaultI18nState,
  deletePerfilLastProfileHandler
} from "../../test/handlers.js";
import { useUiLocaleStore } from "../../i18n/locale.js";
import { ProfileEditor } from "./ProfileEditor.js";

afterEach(() => {
  cleanup();
  useUiLocaleStore.setState({ locale: "es" });
});

function renderEditor(props: Parameters<typeof ProfileEditor>[0]) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(React.createElement(QueryClientProvider, { client: queryClient }, React.createElement(ProfileEditor, props)));
}

function Wrapper({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => new QueryClient({ defaultOptions: { queries: { retry: false } } }));
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

describe("ProfileEditor", () => {
  it("renders nothing when closed, and a labelled dialog when open", () => {
    const { rerender } = render(
      <Wrapper>
        <ProfileEditor open={false} mode="create" onClose={() => {}} />
      </Wrapper>
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    rerender(
      <Wrapper>
        <ProfileEditor open mode="create" onClose={() => {}} />
      </Wrapper>
    );
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(screen.getByText("Nuevo perfil")).toBeInTheDocument();
  });

  it("moves focus to the name field on open", () => {
    renderEditor({ open: true, mode: "create", onClose: () => {} });
    expect(screen.getByLabelText("Nombre")).toHaveFocus();
  });

  it("returns focus to the trigger element when closed (WCAG 2.4.3)", () => {
    function Harness() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>
            abrir
          </button>
          <ProfileEditor open={open} mode="create" onClose={() => setOpen(false)} />
        </>
      );
    }
    render(
      <Wrapper>
        <Harness />
      </Wrapper>
    );
    const trigger = screen.getByRole("button", { name: "abrir" });
    trigger.focus();
    fireEvent.click(trigger);
    expect(screen.getByLabelText("Nombre")).toHaveFocus();

    fireEvent.keyDown(document, { key: "Escape" });
    expect(trigger).toHaveFocus();
  });

  it("calls onClose on close-button click, overlay click, and Escape", () => {
    const onCloseButton = vi.fn();
    const { unmount } = renderEditor({ open: true, mode: "create", onClose: onCloseButton });
    fireEvent.click(screen.getByRole("button", { name: "Cerrar" }));
    expect(onCloseButton).toHaveBeenCalledTimes(1);
    unmount();

    const onCloseOverlay = vi.fn();
    renderEditor({ open: true, mode: "create", onClose: onCloseOverlay });
    fireEvent.mouseDown(screen.getByRole("dialog").parentElement as HTMLElement);
    expect(onCloseOverlay).toHaveBeenCalledTimes(1);

    const onCloseEsc = vi.fn();
    renderEditor({ open: true, mode: "create", onClose: onCloseEsc });
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onCloseEsc).toHaveBeenCalledTimes(1);
  });

  it("rejects an empty name on submit and never fires a request", () => {
    renderEditor({ open: true, mode: "create", onClose: () => {} });

    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));

    expect(screen.getByRole("alert")).toHaveTextContent("El nombre no puede estar vacío.");
  });
});

describe("ProfileEditor create (POST /api/perfiles)", () => {
  it("submitting a valid name POSTs {name, prompt} and closes the dialog on success", async () => {
    let capturedBody: unknown;
    server.use(
      http.post(`${API_BASE_URL}/api/perfiles`, async ({ request }) => {
        capturedBody = await request.json();
        return HttpResponse.json({ name: "Nuevo Perfil", prompt: "Una IA curiosa.", use_system: false });
      })
    );
    const onClose = vi.fn();
    renderEditor({ open: true, mode: "create", onClose });

    fireEvent.change(screen.getByLabelText("Nombre"), { target: { value: "Nuevo Perfil" } });
    fireEvent.change(screen.getByLabelText("System prompt"), { target: { value: "Una IA curiosa." } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(capturedBody).toEqual({ name: "Nuevo Perfil", prompt: "Una IA curiosa.", locale: "es" });
  });

  it("submitting with extended_responses enabled POSTs {name, prompt, extended_responses: true}", async () => {
    let capturedBody: unknown;
    server.use(
      http.post(`${API_BASE_URL}/api/perfiles`, async ({ request }) => {
        capturedBody = await request.json();
        return HttpResponse.json({
          name: "Deep Learner",
          prompt: "Profundo",
          use_system: false,
          extended_responses: true
        });
      })
    );
    const onClose = vi.fn();
    renderEditor({ open: true, mode: "create", onClose });

    fireEvent.change(screen.getByLabelText("Nombre"), { target: { value: "Deep Learner" } });
    fireEvent.change(screen.getByLabelText("System prompt"), { target: { value: "Profundo" } });
    fireEvent.click(screen.getByRole("switch", { name: "Respuestas extendidas (~1 min)" }));
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(capturedBody).toEqual({
      name: "Deep Learner",
      prompt: "Profundo",
      locale: "es",
      extended_responses: true
    });
  });

  it("submitting with use_system enabled POSTs {name, prompt, use_system: true}", async () => {
    let capturedBody: unknown;
    server.use(
      http.post(`${API_BASE_URL}/api/perfiles`, async ({ request }) => {
        capturedBody = await request.json();
        return HttpResponse.json({
          name: "System Prompt Profile",
          prompt: "Instrucciones de sistema",
          use_system: true
        });
      })
    );
    const onClose = vi.fn();
    renderEditor({ open: true, mode: "create", onClose });

    fireEvent.change(screen.getByLabelText("Nombre"), { target: { value: "System Prompt Profile" } });
    fireEvent.change(screen.getByLabelText("System prompt"), { target: { value: "Instrucciones de sistema" } });
    fireEvent.click(screen.getByRole("switch", { name: "Rol de sistema (System prompt)" }));
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(capturedBody).toEqual({
      name: "System Prompt Profile",
      prompt: "Instrucciones de sistema",
      locale: "es",
      use_system: true
    });
  });

  it("submitting with custom max_turns in create mode POSTs {name, prompt, max_turns: 5}", async () => {
    let capturedBody: unknown;
    server.use(
      http.post(`${API_BASE_URL}/api/perfiles`, async ({ request }) => {
        capturedBody = await request.json();
        return HttpResponse.json({
          name: "Long Memory",
          prompt: "Mucho contexto",
          use_system: false,
          max_turns: 5
        });
      })
    );
    const onClose = vi.fn();
    renderEditor({ open: true, mode: "create", onClose });

    fireEvent.change(screen.getByLabelText("Nombre"), { target: { value: "Long Memory" } });
    fireEvent.change(screen.getByLabelText("System prompt"), { target: { value: "Mucho contexto" } });
    fireEvent.change(screen.getByRole("spinbutton", { name: "Turnos de memoria reciente (1-10)" }), {
      target: { value: "5" }
    });
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(capturedBody).toEqual({
      name: "Long Memory",
      prompt: "Mucho contexto",
      locale: "es",
      max_turns: 5
    });
  });

  it("disables Guardar and shows Guardando… while the create request is in flight", async () => {
    let resolveRequest: (() => void) | undefined;
    server.use(
      http.post(`${API_BASE_URL}/api/perfiles`, async () => {
        await new Promise<void>((resolve) => {
          resolveRequest = resolve;
        });
        return HttpResponse.json({ name: "Nueva", prompt: "", use_system: false });
      })
    );
    renderEditor({ open: true, mode: "create", onClose: () => {} });

    fireEvent.change(screen.getByLabelText("Nombre"), { target: { value: "Nueva" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));

    await waitFor(() => expect(screen.getByRole("button", { name: "Guardando…" })).toBeDisabled());
    resolveRequest?.();
  });

  it("surfaces a 409 name-conflict error from the backend and keeps the dialog open", async () => {
    server.use(createPerfilConflictHandler());
    const onClose = vi.fn();
    renderEditor({ open: true, mode: "create", onClose });

    fireEvent.change(screen.getByLabelText("Nombre"), { target: { value: "Akira" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("profile already exists"));
    expect(onClose).not.toHaveBeenCalled();
  });

  it("includes locale: 'en' in createBody when backend active_locale is 'en'", async () => {
    let capturedBody: unknown;
    server.use(
      http.get(`${API_BASE_URL}/api/i18n`, () =>
        HttpResponse.json({ ...defaultI18nState, active_locale: "en", persisted_locale: "en" })
      ),
      http.post(`${API_BASE_URL}/api/perfiles`, async ({ request }) => {
        capturedBody = await request.json();
        return HttpResponse.json({ name: "Tsundere", prompt: "English prompt", use_system: false, locale: "en" });
      })
    );
    const onClose = vi.fn();
    renderEditor({ open: true, mode: "create", onClose });

    fireEvent.change(screen.getByLabelText("Nombre"), { target: { value: "Tsundere" } });
    fireEvent.change(screen.getByLabelText("System prompt"), { target: { value: "English prompt" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(capturedBody).toEqual({ name: "Tsundere", prompt: "English prompt", locale: "en" });
  });

  it("normalizes regional backend active_locale (e.g. 'en-US' -> 'en') in createBody", async () => {
    let capturedBody: unknown;
    server.use(
      http.get(`${API_BASE_URL}/api/i18n`, () =>
        HttpResponse.json({ ...defaultI18nState, active_locale: "en-US", persisted_locale: "en-US" })
      ),
      http.post(`${API_BASE_URL}/api/perfiles`, async ({ request }) => {
        capturedBody = await request.json();
        return HttpResponse.json({ name: "US Profile", prompt: "Hi", use_system: false, locale: "en" });
      })
    );
    const onClose = vi.fn();
    renderEditor({ open: true, mode: "create", onClose });

    fireEvent.change(screen.getByLabelText("Nombre"), { target: { value: "US Profile" } });
    fireEvent.change(screen.getByLabelText("System prompt"), { target: { value: "Hi" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(capturedBody).toEqual({ name: "US Profile", prompt: "Hi", locale: "en" });
  });

  it("includes locale: 'es' in createBody when backend active_locale is 'es'", async () => {
    let capturedBody: unknown;
    server.use(
      http.get(`${API_BASE_URL}/api/i18n`, () =>
        HttpResponse.json({ ...defaultI18nState, active_locale: "es", persisted_locale: "es" })
      ),
      http.post(`${API_BASE_URL}/api/perfiles`, async ({ request }) => {
        capturedBody = await request.json();
        return HttpResponse.json({ name: "Perfil ES", prompt: "Hola", use_system: false, locale: "es" });
      })
    );
    const onClose = vi.fn();
    renderEditor({ open: true, mode: "create", onClose });

    fireEvent.change(screen.getByLabelText("Nombre"), { target: { value: "Perfil ES" } });
    fireEvent.change(screen.getByLabelText("System prompt"), { target: { value: "Hola" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(capturedBody).toEqual({ name: "Perfil ES", prompt: "Hola", locale: "es" });
  });

  it("falls back to uiLocale in createBody when GET /api/i18n fails", async () => {
    useUiLocaleStore.setState({ locale: "en" });
    let capturedBody: unknown;
    server.use(
      http.get(`${API_BASE_URL}/api/i18n`, () => HttpResponse.json({ detail: "fail" }, { status: 500 })),
      http.post(`${API_BASE_URL}/api/perfiles`, async ({ request }) => {
        capturedBody = await request.json();
        return HttpResponse.json({ name: "Fallback EN", prompt: "Hello", use_system: false, locale: "en" });
      })
    );
    const onClose = vi.fn();
    renderEditor({ open: true, mode: "create", onClose });

    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Fallback EN" } });
    fireEvent.change(screen.getByLabelText("System prompt"), { target: { value: "Hello" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(capturedBody).toEqual({ name: "Fallback EN", prompt: "Hello", locale: "en" });
  });
});

describe("ProfileEditor edit (GET/PUT/DELETE /api/perfiles/:name)", () => {
  it("hydrates the prompt textarea from GET /api/perfiles/:name when opening an existing profile", async () => {
    renderEditor({ open: true, mode: "edit", initialName: "Akira", onClose: () => {} });

    await waitFor(() =>
      expect(screen.getByLabelText("System prompt")).toHaveValue("Sos ingeniosa y filosa, con humor seco.")
    );
  });

  it("rename: changing the name field PUTs new_name + the hydrated prompt, and closes on success", async () => {
    let capturedBody: unknown;
    server.use(
      http.put(`${API_BASE_URL}/api/perfiles/Akira`, async ({ request }) => {
        capturedBody = await request.json();
        return HttpResponse.json({ name: "Akira 2", prompt: "Sos ingeniosa y filosa, con humor seco.", use_system: false });
      })
    );
    const onClose = vi.fn();
    renderEditor({ open: true, mode: "edit", initialName: "Akira", onClose });

    await waitFor(() => expect(screen.getByLabelText("System prompt")).toHaveValue("Sos ingeniosa y filosa, con humor seco."));
    fireEvent.change(screen.getByLabelText("Nombre"), { target: { value: "Akira 2" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(capturedBody).toEqual({ new_name: "Akira 2", prompt: "Sos ingeniosa y filosa, con humor seco." });
  });

  it("toggling extended_responses in edit mode sends extended_responses in PUT body", async () => {
    let capturedBody: unknown;
    server.use(
      http.get(`${API_BASE_URL}/api/perfiles/Akira`, () =>
        HttpResponse.json({
          id: "profile-id-akira",
          name: "Akira",
          prompt: "Sos ingeniosa y filosa, con humor seco.",
          use_system: false,
          extended_responses: false
        })
      ),
      http.put(`${API_BASE_URL}/api/perfiles/Akira`, async ({ request }) => {
        capturedBody = await request.json();
        return HttpResponse.json({
          name: "Akira",
          prompt: "Sos ingeniosa y filosa, con humor seco.",
          use_system: false,
          extended_responses: true
        });
      })
    );
    const onClose = vi.fn();
    renderEditor({ open: true, mode: "edit", initialName: "Akira", onClose });

    await waitFor(() =>
      expect(screen.getByLabelText("System prompt")).toHaveValue("Sos ingeniosa y filosa, con humor seco.")
    );
    const toggle = screen.getByRole("switch", { name: "Respuestas extendidas (~1 min)" });
    expect(toggle).toHaveAttribute("aria-checked", "false");
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-checked", "true");

    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(capturedBody).toEqual({
      prompt: "Sos ingeniosa y filosa, con humor seco.",
      extended_responses: true
    });
  });

  it("toggling use_system in edit mode sends use_system in PUT body", async () => {
    let capturedBody: unknown;
    server.use(
      http.get(`${API_BASE_URL}/api/perfiles/Akira`, () =>
        HttpResponse.json({
          id: "profile-id-akira",
          name: "Akira",
          prompt: "Sos ingeniosa y filosa, con humor seco.",
          use_system: false
        })
      ),
      http.put(`${API_BASE_URL}/api/perfiles/Akira`, async ({ request }) => {
        capturedBody = await request.json();
        return HttpResponse.json({
          name: "Akira",
          prompt: "Sos ingeniosa y filosa, con humor seco.",
          use_system: true
        });
      })
    );
    const onClose = vi.fn();
    renderEditor({ open: true, mode: "edit", initialName: "Akira", onClose });

    await waitFor(() =>
      expect(screen.getByLabelText("System prompt")).toHaveValue("Sos ingeniosa y filosa, con humor seco.")
    );
    const toggle = screen.getByRole("switch", { name: "Rol de sistema (System prompt)" });
    expect(toggle).toHaveAttribute("aria-checked", "false");
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-checked", "true");

    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(capturedBody).toEqual({
      prompt: "Sos ingeniosa y filosa, con humor seco.",
      use_system: true
    });
  });

  it("editing max_turns in edit mode sends max_turns in PUT body", async () => {
    let capturedBody: unknown;
    server.use(
      http.get(`${API_BASE_URL}/api/perfiles/Akira`, () =>
        HttpResponse.json({
          id: "profile-id-akira",
          name: "Akira",
          prompt: "Sos ingeniosa y filosa, con humor seco.",
          use_system: false,
          max_turns: 3
        })
      ),
      http.put(`${API_BASE_URL}/api/perfiles/Akira`, async ({ request }) => {
        capturedBody = await request.json();
        return HttpResponse.json({
          name: "Akira",
          prompt: "Sos ingeniosa y filosa, con humor seco.",
          use_system: false,
          max_turns: 7
        });
      })
    );
    const onClose = vi.fn();
    renderEditor({ open: true, mode: "edit", initialName: "Akira", onClose });

    await waitFor(() =>
      expect(screen.getByLabelText("System prompt")).toHaveValue("Sos ingeniosa y filosa, con humor seco.")
    );
    const maxTurnsInput = screen.getByRole("spinbutton", { name: "Turnos de memoria reciente (1-10)" });
    expect(maxTurnsInput).toHaveValue(3);
    fireEvent.change(maxTurnsInput, { target: { value: "7" } });
    expect(maxTurnsInput).toHaveValue(7);

    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(capturedBody).toEqual({
      prompt: "Sos ingeniosa y filosa, con humor seco.",
      max_turns: 7
    });
  });

  it("uses the engine's max_turns_cap from GET as the max_turns input bound", async () => {
    server.use(
      http.get(`${API_BASE_URL}/api/perfiles/Akira`, () =>
        HttpResponse.json({
          id: "profile-id-akira",
          name: "Akira",
          prompt: "Sos ingeniosa y filosa, con humor seco.",
          use_system: false,
          max_turns: 25,
          max_turns_cap: 40
        })
      )
    );
    renderEditor({ open: true, mode: "edit", initialName: "Akira", onClose: vi.fn() });

    const maxTurnsInput = await screen.findByRole("spinbutton", { name: "Turnos de memoria reciente (1-40)" });
    await waitFor(() => expect(maxTurnsInput).toHaveValue(25));
    expect(maxTurnsInput).toHaveAttribute("max", "40");
    fireEvent.change(maxTurnsInput, { target: { value: "99" } });
    expect(maxTurnsInput).toHaveValue(40);
  });

  it("falls back to a max_turns bound of 10 when the API reports no cap", () => {
    renderEditor({ open: true, mode: "create", onClose: vi.fn() });

    const maxTurnsInput = screen.getByRole("spinbutton", { name: "Turnos de memoria reciente (1-10)" });
    expect(maxTurnsInput).toHaveAttribute("max", "10");
    fireEvent.change(maxTurnsInput, { target: { value: "25" } });
    expect(maxTurnsInput).toHaveValue(10);
  });

  it("delete confirm DELETEs /api/perfiles/:name and closes the dialog on success", async () => {
    let deleteCalled = false;
    server.use(
      http.delete(`${API_BASE_URL}/api/perfiles/Akira`, () => {
        deleteCalled = true;
        return HttpResponse.json({ ok: true });
      })
    );
    const onClose = vi.fn();
    renderEditor({ open: true, mode: "edit", initialName: "Akira", onClose });

    fireEvent.click(screen.getByRole("button", { name: "Eliminar" }));
    expect(screen.getByText(/Esta acción borra el perfil «Akira»/)).toBeInTheDocument();
    // Destructive button is gated on the acknowledgment.
    expect(screen.getByRole("button", { name: "Eliminar perfil" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Sí, entiendo" }));
    fireEvent.click(screen.getByRole("button", { name: "Eliminar perfil" }));

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(deleteCalled).toBe(true);
  });

  it("surfaces the 409 last-profile-delete guard from the backend and keeps the dialog open", async () => {
    server.use(deletePerfilLastProfileHandler());
    const onClose = vi.fn();
    renderEditor({ open: true, mode: "edit", initialName: "default", onClose });

    fireEvent.click(screen.getByRole("button", { name: "Eliminar" }));
    fireEvent.click(screen.getByRole("button", { name: "Sí, entiendo" }));
    fireEvent.click(screen.getByRole("button", { name: "Eliminar perfil" }));

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("cannot delete the last profile"));
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe("ProfileEditor delete + purge memoria (POST /api/memoria/purge)", () => {
  it("purge checkbox defaults to true and fires DELETE then purges memoria by the hydrated profile id, closing only once both succeed", async () => {
    let deleteCalled = false;
    let purgeBody: unknown;
    server.use(
      http.delete(`${API_BASE_URL}/api/perfiles/Akira`, () => {
        deleteCalled = true;
        return HttpResponse.json({ ok: true });
      }),
      http.post(`${API_BASE_URL}/api/memoria/purge`, async ({ request }) => {
        purgeBody = await request.json();
        return HttpResponse.json({ deleted: 3 });
      })
    );
    const onClose = vi.fn();
    renderEditor({ open: true, mode: "edit", initialName: "Akira", onClose });

    // Wait for GET /api/perfiles/Akira to hydrate the profile's real `id`
    // before deleting — the purge must target that id, never the name.
    await waitFor(() => expect(screen.getByLabelText("System prompt")).toHaveValue("Sos ingeniosa y filosa, con humor seco."));

    fireEvent.click(screen.getByRole("button", { name: "Eliminar" }));
    expect(screen.getByRole("button", { name: "Purgar memoria asociada a este perfil" })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
    fireEvent.click(screen.getByRole("button", { name: "Sí, entiendo" }));
    fireEvent.click(screen.getByRole("button", { name: "Eliminar perfil" }));

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(deleteCalled).toBe(true);
    expect(purgeBody).toEqual({ profile_id: "profile-id-akira" });
  });

  it("keeps the dialog open with a visible error when the purge fails after a successful delete", async () => {
    server.use(
      http.delete(`${API_BASE_URL}/api/perfiles/Akira`, () => HttpResponse.json({ ok: true })),
      http.post(`${API_BASE_URL}/api/memoria/purge`, () => HttpResponse.json({ detail: "memoria_unavailable" }, { status: 503 }))
    );
    const onClose = vi.fn();
    renderEditor({ open: true, mode: "edit", initialName: "Akira", onClose });

    await waitFor(() => expect(screen.getByLabelText("System prompt")).toHaveValue("Sos ingeniosa y filosa, con humor seco."));

    fireEvent.click(screen.getByRole("button", { name: "Eliminar" }));
    fireEvent.click(screen.getByRole("button", { name: "Sí, entiendo" }));
    fireEvent.click(screen.getByRole("button", { name: "Eliminar perfil" }));

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("Se eliminó «Akira», pero no se pudo purgar su memoria asociada.")
    );
    expect(onClose).not.toHaveBeenCalled();

    // Retry succeeds and closes the dialog.
    server.use(http.post(`${API_BASE_URL}/api/memoria/purge`, () => HttpResponse.json({ deleted: 1 })));
    fireEvent.click(screen.getByRole("button", { name: "Reintentar purga" }));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it("unticking the purge checkbox skips POST /api/memoria/purge and closes after DELETE", async () => {
    let deleteCalled = false;
    let purgeCalled = false;
    server.use(
      http.delete(`${API_BASE_URL}/api/perfiles/Akira`, () => {
        deleteCalled = true;
        return HttpResponse.json({ ok: true });
      }),
      http.post(`${API_BASE_URL}/api/memoria/purge`, () => {
        purgeCalled = true;
        return HttpResponse.json({ deleted: 0 });
      })
    );
    const onClose = vi.fn();
    renderEditor({ open: true, mode: "edit", initialName: "Akira", onClose });

    await waitFor(() => expect(screen.getByLabelText("System prompt")).toHaveValue("Sos ingeniosa y filosa, con humor seco."));

    fireEvent.click(screen.getByRole("button", { name: "Eliminar" }));
    const purgeToggle = screen.getByRole("button", { name: "Purgar memoria asociada a este perfil" });
    expect(purgeToggle).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(purgeToggle);
    expect(purgeToggle).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(screen.getByRole("button", { name: "Sí, entiendo" }));
    fireEvent.click(screen.getByRole("button", { name: "Eliminar perfil" }));

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(deleteCalled).toBe(true);
    expect(purgeCalled).toBe(false);
  });
});

describe("ProfileEditor warmth selector", () => {
  const detail = (warmth?: string) => ({
    id: "profile-id-akira",
    name: "Akira",
    prompt: "Eres ingeniosa.",
    use_system: false,
    ...(warmth ? { warmth } : {})
  });

  const slider = () => screen.getByRole("slider", { name: "Calidez emocional" });

  it("renders a five-stop warmth slider with the current level, hint and the human-claim note, defaulting to cold", () => {
    renderEditor({ open: true, mode: "create", onClose: () => {} });
    const input = slider();
    expect(input).toHaveAttribute("min", "0");
    expect(input).toHaveAttribute("max", "4");
    expect(input).toHaveValue("0");
    expect(input).toHaveAttribute("aria-valuetext", "Fría");
    expect(screen.getByTestId("warmth-current")).toHaveTextContent("Fría");
    expect(screen.getByText(/La Kira seca de siempre/)).toBeInTheDocument();
    expect(screen.getByText(/nunca afirma ser humana ni tener cuerpo/)).toBeInTheDocument();
    expect(screen.queryByRole("radio")).not.toBeInTheDocument();
  });

  it("moving the slider updates header, aria-valuetext and hint, ending at Sentimental", () => {
    renderEditor({ open: true, mode: "create", onClose: () => {} });
    fireEvent.change(slider(), { target: { value: "2" } });
    expect(slider()).toHaveAttribute("aria-valuetext", "En personaje");
    expect(screen.getByTestId("warmth-current")).toHaveTextContent("En personaje");
    expect(screen.getByText(/Expresa sentimientos como el personaje/)).toBeInTheDocument();
    fireEvent.change(slider(), { target: { value: "4" } });
    expect(slider()).toHaveAttribute("aria-valuetext", "Sentimental");
    expect(screen.getByText(/Muy afectuosa: te consuela primero/)).toBeInTheDocument();
  });

  it("create sends sentimental when the slider is at the top stop", async () => {
    let captured: unknown;
    server.use(
      http.post(`${API_BASE_URL}/api/perfiles`, async ({ request }) => {
        captured = await request.json();
        return HttpResponse.json(detail("sentimental"), { status: 201 });
      })
    );
    const onClose = vi.fn();
    renderEditor({ open: true, mode: "create", onClose });
    fireEvent.change(screen.getByLabelText("Nombre"), { target: { value: "Akira" } });
    fireEvent.change(slider(), { target: { value: "4" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(captured).toEqual({ name: "Akira", prompt: "", locale: "es", warmth: "sentimental" });
  });

  it("create sends warmth only when not cold", async () => {
    let captured: unknown;
    server.use(
      http.post(`${API_BASE_URL}/api/perfiles`, async ({ request }) => {
        captured = await request.json();
        return HttpResponse.json(detail("empathetic"), { status: 201 });
      })
    );
    const onClose = vi.fn();
    renderEditor({ open: true, mode: "create", onClose });
    fireEvent.change(screen.getByLabelText("Nombre"), { target: { value: "Akira" } });
    fireEvent.change(slider(), { target: { value: "1" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(captured).toEqual({ name: "Akira", prompt: "", locale: "es", warmth: "empathetic" });
  });

  it("edit hydrates warmth and PUTs only when it changed", async () => {
    let captured: unknown;
    server.use(
      http.get(`${API_BASE_URL}/api/perfiles/Akira`, () => HttpResponse.json(detail("in_character"))),
      http.put(`${API_BASE_URL}/api/perfiles/Akira`, async ({ request }) => {
        captured = await request.json();
        return HttpResponse.json(detail("free"));
      })
    );
    const onClose = vi.fn();
    renderEditor({ open: true, mode: "edit", initialName: "Akira", onClose });
    await waitFor(() => expect(slider()).toHaveAttribute("aria-valuetext", "En personaje"));
    fireEvent.change(slider(), { target: { value: "3" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(captured).toEqual({ prompt: "Eres ingeniosa.", warmth: "free" });
  });

  it("saving the ACTIVE profile re-applies it through the switch API", async () => {
    let switched: unknown;
    server.use(
      http.get(`${API_BASE_URL}/api/perfiles/Akira`, () => HttpResponse.json(detail("cold"))),
      http.put(`${API_BASE_URL}/api/perfiles/Akira`, () => HttpResponse.json(detail("free"))),
      http.post(`${API_BASE_URL}/api/perfiles/switch`, async ({ request }) => {
        switched = await request.json();
        return HttpResponse.json({ command_id: "c1", status: "queued" }, { status: 202 });
      })
    );
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    queryClient.setQueryData(["status"], { active_profile: "Akira" });
    const onClose = vi.fn();
    render(
      <QueryClientProvider client={queryClient}>
        <ProfileEditor open mode="edit" initialName="Akira" onClose={onClose} />
      </QueryClientProvider>
    );
    await waitFor(() => expect(screen.getByLabelText("System prompt")).toHaveValue("Eres ingeniosa."));
    fireEvent.change(slider(), { target: { value: "3" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));
    await waitFor(() => expect(switched).toEqual({ name: "Akira" }));
  });

  it("saving a NON-active profile does not switch", async () => {
    let switchCalls = 0;
    server.use(
      http.get(`${API_BASE_URL}/api/perfiles/Akira`, () => HttpResponse.json(detail("cold"))),
      http.put(`${API_BASE_URL}/api/perfiles/Akira`, () => HttpResponse.json(detail("free"))),
      http.post(`${API_BASE_URL}/api/perfiles/switch`, () => {
        switchCalls += 1;
        return HttpResponse.json({ command_id: "c1", status: "queued" }, { status: 202 });
      })
    );
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    queryClient.setQueryData(["status"], { active_profile: "Otra" });
    const onClose = vi.fn();
    render(
      <QueryClientProvider client={queryClient}>
        <ProfileEditor open mode="edit" initialName="Akira" onClose={onClose} />
      </QueryClientProvider>
    );
    await waitFor(() => expect(screen.getByLabelText("System prompt")).toHaveValue("Eres ingeniosa."));
    fireEvent.change(slider(), { target: { value: "3" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(switchCalls).toBe(0);
  });
});

describe("ProfileEditor owner address selector (owner_gender)", () => {
  const detail = (ownerGender?: string) => ({
    id: "profile-id-akira",
    name: "Akira",
    prompt: "Eres ingeniosa.",
    use_system: false,
    ...(ownerGender !== undefined ? { owner_gender: ownerGender } : {})
  });

  const select = () => screen.getByRole("combobox", { name: "Cómo se dirige Kira a ti" });

  it("defaults to unspecified with the four options and a hint", () => {
    renderEditor({ open: true, mode: "create", onClose: () => {} });
    expect(select()).toHaveTextContent("Sin especificar");
    fireEvent.click(select());
    const labels = screen.getAllByRole("option").map((o) => o.textContent?.replace("✓", "").trim());
    expect(labels).toEqual(["Sin especificar", "Masculino", "Femenino", "Neutro"]);
    expect(screen.getByText(/Sin especificar, Kira no lo asume/)).toBeInTheDocument();
  });

  const LABELS: Record<string, string> = { "": "Sin especificar", masculine: "Masculino", feminine: "Femenino", neutral: "Neutro" };
  function pick(value: string) {
    fireEvent.click(select());
    fireEvent.click(screen.getByRole("option", { name: new RegExp(`^${LABELS[value]}`) }));
  }

  async function createWith(ownerGender: string | null) {
    let captured: unknown;
    server.use(
      http.post(`${API_BASE_URL}/api/perfiles`, async ({ request }) => {
        captured = await request.json();
        return HttpResponse.json(detail("feminine"), { status: 201 });
      })
    );
    const onClose = vi.fn();
    renderEditor({ open: true, mode: "create", onClose });
    fireEvent.change(screen.getByLabelText("Nombre"), { target: { value: "Akira" } });
    if (ownerGender !== null) pick(ownerGender);
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    return captured;
  }

  it("create omits owner_gender when unspecified", async () => {
    expect(await createWith(null)).toEqual({ name: "Akira", prompt: "", locale: "es" });
  });

  it("create sends owner_gender when chosen", async () => {
    expect(await createWith("feminine")).toEqual({ name: "Akira", prompt: "", locale: "es", owner_gender: "feminine" });
  });

  it("edit hydrates the stored value and PUTs only when it changed (including back to unspecified)", async () => {
    const bodies: unknown[] = [];
    server.use(
      http.get(`${API_BASE_URL}/api/perfiles/Akira`, () => HttpResponse.json(detail("masculine"))),
      http.put(`${API_BASE_URL}/api/perfiles/Akira`, async ({ request }) => {
        bodies.push(await request.json());
        return HttpResponse.json(detail(""));
      })
    );
    const onClose = vi.fn();
    renderEditor({ open: true, mode: "edit", initialName: "Akira", onClose });
    await waitFor(() => expect(select()).toHaveTextContent("Masculino"));
    pick("");
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(bodies[0]).toEqual({ prompt: "Eres ingeniosa.", owner_gender: "" });
  });

  it("edit with no change does not send owner_gender", async () => {
    const bodies: unknown[] = [];
    server.use(
      http.get(`${API_BASE_URL}/api/perfiles/Akira`, () => HttpResponse.json(detail())),
      http.put(`${API_BASE_URL}/api/perfiles/Akira`, async ({ request }) => {
        bodies.push(await request.json());
        return HttpResponse.json(detail());
      })
    );
    const onClose = vi.fn();
    renderEditor({ open: true, mode: "edit", initialName: "Akira", onClose });
    await waitFor(() => expect(screen.getByLabelText("System prompt")).toHaveValue("Eres ingeniosa."));
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(bodies[0]).toEqual({ prompt: "Eres ingeniosa." });
  });
});

describe("ProfileEditor layout (no invented group titles, footer delete)", () => {
  it("renders no invented group headings", () => {
    useUiLocaleStore.setState({ locale: "en" });
    renderEditor({ open: true, mode: "edit", initialName: "Akira", onClose: () => {} });
    for (const title of ["Identity", "Personality", "Conversation", "Advanced", "Danger zone"]) {
      expect(screen.queryByRole("heading", { name: title })).not.toBeInTheDocument();
    }
  });

  it("edit mode puts Delete in the footer row with Save, before Cancel", () => {
    useUiLocaleStore.setState({ locale: "en" });
    renderEditor({ open: true, mode: "edit", initialName: "Akira", onClose: () => {} });
    const save = screen.getByRole("button", { name: "Save" });
    const footer = save.closest("div") as HTMLElement;
    const del = within(footer).getByRole("button", { name: "Delete" });
    const cancel = within(footer).getByRole("button", { name: "Cancel" });
    expect(del.compareDocumentPosition(cancel) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getAllByRole("button", { name: "Delete" })).toHaveLength(1);
  });

  it("create mode renders no Delete button", () => {
    useUiLocaleStore.setState({ locale: "en" });
    renderEditor({ open: true, mode: "create", onClose: () => {} });
    expect(screen.queryByRole("button", { name: "Delete" })).not.toBeInTheDocument();
  });
});
