import { http, HttpResponse } from "msw";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import React, { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { server } from "../test/server.js";
import {
  API_BASE_URL,
  createPerfilConflictHandler,
  deletePerfilLastProfileHandler
} from "../test/handlers.js";
import { ProfileEditor } from "./ProfileEditor.js";

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
    expect(capturedBody).toEqual({ name: "Nuevo Perfil", prompt: "Una IA curiosa." });
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
  it("ticking the purge checkbox fires DELETE then purges memoria by the hydrated profile id, closing only once both succeed", async () => {
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
    fireEvent.click(screen.getByLabelText("Purgar memoria asociada a este perfil"));
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
    fireEvent.click(screen.getByLabelText("Purgar memoria asociada a este perfil"));
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
});
