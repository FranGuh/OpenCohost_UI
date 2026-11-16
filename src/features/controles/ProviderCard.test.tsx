import { http, HttpResponse } from "msw";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { describe, expect, it, vi } from "vitest";
import { server } from "../../test/server.js";
import {
  API_BASE_URL,
  defaultLlmProvider,
  llmProviderGetErrorHandler,
  llmProviderGetHandler,
  llmProviderRouteMissingHandler,
  llmProviderTestHandler,
  llmProviderValidationHandler,
  llmProviderWriteFailedHandler
} from "../../test/handlers.js";
import type { LlmProviderResponseFixture } from "../../test/handlers.js";
import { ProviderCard } from "./ProviderCard.js";

function renderCard() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(React.createElement(QueryClientProvider, { client: queryClient }, React.createElement(ProviderCard)));
}

/** Switch the active-provider CustomSelect to `optionName`. */
function pickActiveProvider(optionName: string) {
  fireEvent.click(screen.getByRole("combobox", { name: "Proveedor activo" }));
  fireEvent.click(screen.getByRole("option", { name: optionName }));
}

describe("ProviderCard hydrates from GET /api/llm/provider", () => {
  it("shows the active provider and the failure/spend posture from the fetched config", async () => {
    renderCard();

    await waitFor(() =>
      expect(screen.getByRole("combobox", { name: "Proveedor activo" })).toHaveTextContent("Local (Ollama)")
    );
    expect(screen.getByRole("button", { name: "Cambiar a local" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("switch", { name: "Pregenerar respuestas en la nube" })).toHaveAttribute(
      "aria-checked",
      "false"
    );
  });

  it("surfaces the backend-old 404 route-missing copy honestly (no fake config)", async () => {
    server.use(llmProviderRouteMissingHandler());
    renderCard();

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(
        "El backend en ejecución todavía no tiene proveedores en la nube — cierra y vuelve a abrir la app."
      )
    );
    expect(screen.queryByRole("combobox", { name: "Proveedor activo" })).not.toBeInTheDocument();
  });

  it("surfaces a non-404 GET failure with load-specific copy, not the save-error copy (F3)", async () => {
    server.use(llmProviderGetErrorHandler());
    renderCard();

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(
        "No se pudo cargar la configuración del proveedor."
      )
    );
  });

  it("associates the 'Proveedor activo' and 'Preset' labels with their controls (F2)", async () => {
    renderCard();

    await screen.findByRole("combobox", { name: "Proveedor activo" });
    expect(screen.getByLabelText("Proveedor activo")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /OpenAI/ }));
    expect(screen.getByLabelText("Preset")).toBeInTheDocument();
  });
});

describe("ProviderCard 'discard stale speech on a regenerated reply' toggle (T4, live_session_fixes_20260925)", () => {
  it("reflects OFF from the fetched config by default", async () => {
    renderCard();

    await waitFor(() =>
      expect(
        screen.getByRole("switch", { name: "Descartar el habla pendiente al llegar una respuesta regenerada" })
      ).toHaveAttribute("aria-checked", "false")
    );
  });

  it("reflects ON when the fetched config has it enabled", async () => {
    server.use(
      llmProviderGetHandler({ ...defaultLlmProvider, discard_stale_speech_on_regenerated_reply: true })
    );
    renderCard();

    await waitFor(() =>
      expect(
        screen.getByRole("switch", { name: "Descartar el habla pendiente al llegar una respuesta regenerada" })
      ).toHaveAttribute("aria-checked", "true")
    );
  });

  it("PUTs only { discard_stale_speech_on_regenerated_reply } when toggled on", async () => {
    let capturedBody: unknown;
    server.use(
      http.put(`${API_BASE_URL}/api/llm/provider`, async ({ request }) => {
        capturedBody = await request.json();
        return HttpResponse.json({ ...defaultLlmProvider, discard_stale_speech_on_regenerated_reply: true });
      })
    );
    renderCard();
    await screen.findByRole("switch", {
      name: "Descartar el habla pendiente al llegar una respuesta regenerada"
    });

    fireEvent.click(
      screen.getByRole("switch", { name: "Descartar el habla pendiente al llegar una respuesta regenerada" })
    );

    await waitFor(() =>
      expect(capturedBody).toEqual({ discard_stale_speech_on_regenerated_reply: true })
    );
    await waitFor(() =>
      expect(
        screen.getByRole("switch", { name: "Descartar el habla pendiente al llegar una respuesta regenerada" })
      ).toHaveAttribute("aria-checked", "true")
    );
  });
});

describe("ProviderCard 'Configurar proveedores' default-open follows whether profiles exist (owner: compact for local-only, expanded for cloud users)", () => {
  it("opens by default when at least one profile is already configured", async () => {
    renderCard();

    await screen.findByRole("combobox", { name: "Proveedor activo" });
    expect(document.querySelector("details")).toHaveAttribute("open");
    // Inner content visible without a click.
    expect(screen.getByRole("button", { name: /OpenAI/ })).toBeInTheDocument();
  });

  it("stays collapsed by default when there are no configured profiles", async () => {
    server.use(llmProviderGetHandler({ ...defaultLlmProvider, profiles: {} }));
    renderCard();

    await screen.findByRole("combobox", { name: "Proveedor activo" });
    expect(document.querySelector("details")).not.toHaveAttribute("open");
  });

  it("lets the operator manually collapse the section after the profiles-exist default opened it", async () => {
    renderCard();

    await screen.findByRole("combobox", { name: "Proveedor activo" });
    const details = document.querySelector("details") as HTMLDetailsElement;
    expect(details).toHaveAttribute("open");

    fireEvent.click(screen.getByText("Configurar proveedores"));
    expect(details).not.toHaveAttribute("open");
  });

  it("lets the operator manually expand the section after the empty-profiles default collapsed it", async () => {
    server.use(llmProviderGetHandler({ ...defaultLlmProvider, profiles: {} }));
    renderCard();

    await screen.findByRole("combobox", { name: "Proveedor activo" });
    const details = document.querySelector("details") as HTMLDetailsElement;
    expect(details).not.toHaveAttribute("open");

    fireEvent.click(screen.getByText("Configurar proveedores"));
    expect(details).toHaveAttribute("open");
  });
});

describe("ProviderCard active-provider selector is a selector-only switch", () => {
  it("PUTs only { active_provider } — it never rewrites a profile", async () => {
    let capturedBody: unknown;
    server.use(
      http.put(`${API_BASE_URL}/api/llm/provider`, async ({ request }) => {
        capturedBody = await request.json();
        return HttpResponse.json({ ...defaultLlmProvider, active_provider: "openai" });
      })
    );
    renderCard();
    await screen.findByRole("combobox", { name: "Proveedor activo" });

    pickActiveProvider("OpenAI");

    await waitFor(() => expect(capturedBody).toEqual({ active_provider: "openai" }));
  });

  it("surfaces the exact activation-time missing field and does NOT show a fake success", async () => {
    server.use(llmProviderValidationHandler("api_key required for active cloud profile"));
    renderCard();
    await screen.findByRole("combobox", { name: "Proveedor activo" });

    pickActiveProvider("OpenAI");

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(
        "Para activar este proveedor en la nube falta la API key."
      )
    );
    // The selector snapped back — no fake activation.
    expect(screen.getByRole("combobox", { name: "Proveedor activo" })).toHaveTextContent("Local (Ollama)");
  });

  it("preserves the SPECIFIC missing field for base_url and model variants", async () => {
    server.use(llmProviderValidationHandler("base_url required for active cloud profile"));
    renderCard();
    await screen.findByRole("combobox", { name: "Proveedor activo" });
    pickActiveProvider("OpenAI");
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(
        "Para activar este proveedor en la nube falta la URL base (base_url)."
      )
    );
  });
});

describe("ProviderCard sees-images checkbox (cloud-providers-vision P2)", () => {
  it("is an unchecked checkbox in Advanced and is not sent when untouched", async () => {
    let capturedBody: any;
    server.use(
      http.put(`${API_BASE_URL}/api/llm/provider`, async ({ request }) => {
        capturedBody = await request.json();
        return HttpResponse.json(defaultLlmProvider);
      })
    );
    renderCard();
    fireEvent.click(await screen.findByRole("button", { name: /OpenAI/ }));
    const box = screen.getByRole("checkbox", { name: "Este modelo ve imágenes" });
    expect(box).not.toBeChecked();
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));
    await waitFor(() => expect(capturedBody?.profile_id).toBe("openai"));
    expect(capturedBody).not.toHaveProperty("model_vision");
  });

  it("ticking it saves model_vision: true on the profile", async () => {
    let capturedBody: any;
    server.use(
      http.put(`${API_BASE_URL}/api/llm/provider`, async ({ request }) => {
        capturedBody = await request.json();
        return HttpResponse.json(defaultLlmProvider);
      })
    );
    renderCard();
    fireEvent.click(await screen.findByRole("button", { name: /OpenAI/ }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Este modelo ve imágenes" }));
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));
    await waitFor(() => expect(capturedBody?.model_vision).toBe(true));
  });

  it("hydrates checked from the stored profile and can be cleared", async () => {
    let capturedBody: any;
    const stored: LlmProviderResponseFixture = {
      ...defaultLlmProvider,
      profiles: { openai: { ...defaultLlmProvider.profiles.openai, model_vision: true } }
    };
    server.use(
      llmProviderGetHandler(stored),
      http.put(`${API_BASE_URL}/api/llm/provider`, async ({ request }) => {
        capturedBody = await request.json();
        return HttpResponse.json(stored);
      })
    );
    renderCard();
    fireEvent.click(await screen.findByRole("button", { name: /OpenAI/ }));
    const box = screen.getByRole("checkbox", { name: "Este modelo ve imágenes" });
    expect(box).toBeChecked();
    fireEvent.click(box);
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));
    await waitFor(() => expect(capturedBody?.model_vision).toBe(false));
  });
});

describe("ProviderCard per-profile editor", () => {
  it("saves an edited profile via a profile-scoped PUT (profile_id + fields)", async () => {
    let capturedBody: any;
    server.use(
      http.put(`${API_BASE_URL}/api/llm/provider`, async ({ request }) => {
        capturedBody = await request.json();
        return HttpResponse.json(defaultLlmProvider);
      })
    );
    renderCard();

    // Open the configured OpenAI profile in the editor.
    fireEvent.click(await screen.findByRole("button", { name: /OpenAI/ }));
    fireEvent.change(screen.getByLabelText("Modelo"), { target: { value: "gpt-4o" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));

    await waitFor(() => expect(capturedBody?.profile_id).toBe("openai"));
    expect(capturedBody.model).toBe("gpt-4o");
    expect(capturedBody).not.toHaveProperty("active_provider");
    // No key typed → api_key omitted entirely.
    expect(capturedBody).not.toHaveProperty("api_key");
  });

  it("never renders a stored key, sends api_key only when typed, and clears it after save", async () => {
    let capturedBody: any;
    server.use(
      http.put(`${API_BASE_URL}/api/llm/provider`, async ({ request }) => {
        capturedBody = await request.json();
        return HttpResponse.json(defaultLlmProvider);
      })
    );
    renderCard();

    fireEvent.click(await screen.findByRole("button", { name: /OpenAI/ }));

    // Write-only: even though openai.api_key_set is true, the field is empty and
    // a "key guardada" badge stands in for the (never-echoed) stored key.
    const keyInput = screen.getByLabelText("API key") as HTMLInputElement;
    expect(keyInput).toHaveValue("");
    expect(keyInput).toHaveAttribute("type", "password");
    expect(screen.getByText("key guardada")).toBeInTheDocument();

    fireEvent.change(keyInput, { target: { value: "sk-typed-secret" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));

    await waitFor(() => expect(capturedBody?.api_key).toBe("sk-typed-secret"));
    // Cleared back to empty after the save — nothing round-trips.
    await waitFor(() => expect(screen.getByLabelText("API key")).toHaveValue(""));
    // The secret never appears anywhere in the rendered DOM.
    expect(document.body.textContent).not.toContain("sk-typed-secret");
  });

  it("'Borrar key' sends a profile-scoped api_key: '' for that profile only", async () => {
    let capturedBody: unknown;
    server.use(
      http.put(`${API_BASE_URL}/api/llm/provider`, async ({ request }) => {
        capturedBody = await request.json();
        return HttpResponse.json({
          ...defaultLlmProvider,
          profiles: { openai: { ...defaultLlmProvider.profiles.openai, api_key_set: false } }
        });
      })
    );
    renderCard();

    fireEvent.click(await screen.findByRole("button", { name: /OpenAI/ }));
    fireEvent.click(screen.getByRole("button", { name: "Borrar key" }));

    await waitFor(() => expect(capturedBody).toEqual({ profile_id: "openai", api_key: "" }));
  });

  it("saves an incomplete inactive profile as a draft without an error (activation is enforced elsewhere)", async () => {
    let capturedBody: any;
    server.use(
      http.put(`${API_BASE_URL}/api/llm/provider`, async ({ request }) => {
        capturedBody = await request.json();
        return HttpResponse.json(defaultLlmProvider);
      })
    );
    renderCard();

    // NVIDIA NIM is not configured in the default fixture → an "Agregar" draft row.
    fireEvent.click(await screen.findByRole("button", { name: /Agregar NVIDIA NIM/ }));
    // base_url is prefilled from the preset; leave model empty (incomplete draft).
    expect(screen.getByLabelText("URL base")).toHaveValue("https://integrate.api.nvidia.com/v1");
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));

    await waitFor(() => expect(capturedBody?.profile_id).toBe("nvidia_nim"));
    // F5: model is left untouched-empty with a preset selected — it must be
    // OMITTED (not an explicit "") so the server's preset prefill can apply.
    expect(capturedBody).not.toHaveProperty("model");
    expect(capturedBody.base_url).toBe("https://integrate.api.nvidia.com/v1");
    // Draft save succeeded — no error surfaced.
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("disables Guardar for a custom id the inline hint already flagged invalid (F4)", async () => {
    renderCard();
    fireEvent.click(await screen.findByRole("button", { name: "Agregar proveedor…" }));

    fireEvent.change(screen.getByLabelText("Id del proveedor"), { target: { value: "Mi Proveedor" } });
    expect(screen.getByText(/Usa minúsculas, números y guion bajo/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Guardar" })).toBeDisabled();

    fireEvent.change(screen.getByLabelText("Id del proveedor"), { target: { value: "mi_proveedor" } });
    expect(screen.getByRole("button", { name: "Guardar" })).toBeEnabled();
  });

  it("disables the global controls while a profile-save PUT is in flight (F6)", async () => {
    let resolvePut: (value: Response) => void = () => {};
    server.use(
      http.put(
        `${API_BASE_URL}/api/llm/provider`,
        () => new Promise<Response>((resolve) => { resolvePut = resolve; })
      )
    );
    renderCard();

    fireEvent.click(await screen.findByRole("button", { name: /OpenAI/ }));
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));

    await waitFor(() => expect(screen.getByRole("combobox", { name: "Proveedor activo" })).toBeDisabled());
    expect(screen.getByRole("button", { name: "Cambiar a local" })).toBeDisabled();
    expect(screen.getByRole("switch", { name: "Pregenerar respuestas en la nube" })).toBeDisabled();

    resolvePut(HttpResponse.json(defaultLlmProvider));
    await waitFor(() => expect(screen.getByRole("combobox", { name: "Proveedor activo" })).not.toBeDisabled());
  });

  it("surfaces a 503 key_store_write_failed with its specific copy (F7)", async () => {
    server.use(llmProviderWriteFailedHandler("key_store_write_failed"));
    renderCard();

    fireEvent.click(await screen.findByRole("button", { name: /OpenAI/ }));
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(
        "No se pudo guardar la API key en el almacén seguro. Prueba de nuevo."
      )
    );
  });
});

describe("ProviderCard delete-key on the ACTIVE cloud profile (owner: 'no deja editar' after borrar key)", () => {
  const activeKeyedFixture: LlmProviderResponseFixture = {
    active_provider: "openai",
    fallback_mode: "manual",
    pregen_enabled: false,
    discard_stale_speech_on_regenerated_reply: false,
    profiles: {
      openai: { base_url: "https://api.openai.com/v1", model: "gpt-4o-mini", preset: "openai", api_key_set: true }
    }
  };

  it("renders an ACTIONABLE 'switch to Local first' message next to Borrar key — not the misleading activation copy", async () => {
    server.use(llmProviderGetHandler(activeKeyedFixture));
    server.use(llmProviderValidationHandler("api_key required for active cloud profile"));
    renderCard();

    fireEvent.click(await screen.findByRole("button", { name: /OpenAI/ }));
    fireEvent.click(screen.getByRole("button", { name: "Borrar key" }));

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(
        "Para borrar la key del proveedor activo, primero cambia a Local u otro proveedor."
      )
    );
    // The backend safety rule is UNCHANGED; it's just communicated honestly now —
    // NOT the "falta la API key" activation copy that confused the owner.
    expect(screen.getByRole("alert")).not.toHaveTextContent("falta la API key");
  });

  it("stays editable and clears the stale error when the operator edits a field after the 422 (recovery)", async () => {
    server.use(llmProviderGetHandler(activeKeyedFixture));
    server.use(llmProviderValidationHandler("api_key required for active cloud profile"));
    renderCard();

    fireEvent.click(await screen.findByRole("button", { name: /OpenAI/ }));
    fireEvent.click(screen.getByRole("button", { name: "Borrar key" }));
    await screen.findByRole("alert");

    // Correcting the input recovers the form — the stale error disappears and
    // Guardar is usable again (no stuck pending/error state).
    fireEvent.change(screen.getByLabelText("Modelo"), { target: { value: "gpt-4o" } });
    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Guardar" })).toBeEnabled();
  });
});

describe("ProviderCard custom-id validation (owner tried to add 'z-ai')", () => {
  it("shows an UNMISSABLE reason next to the disabled Guardar and a clickable sanitized suggestion that unblocks it", async () => {
    renderCard();
    fireEvent.click(await screen.findByRole("button", { name: "Agregar proveedor…" }));

    fireEvent.change(screen.getByLabelText("Id del proveedor"), { target: { value: "z-ai" } });
    expect(screen.getByRole("button", { name: "Guardar" })).toBeDisabled();

    // Adjacent to the button (not only the inline field hint): a suggested valid id.
    const suggestion = screen.getByRole("button", { name: "z_ai" });
    expect(suggestion).toBeInTheDocument();

    // Applying the suggestion fixes the id and enables Guardar.
    fireEvent.click(suggestion);
    expect(screen.getByLabelText("Id del proveedor")).toHaveValue("z_ai");
    expect(screen.getByRole("button", { name: "Guardar" })).toBeEnabled();
  });
});

describe("ProviderCard eliminar proveedor (owner hit a wall: schema had no delete for nvidia_nim)", () => {
  const activeFixture: LlmProviderResponseFixture = {
    active_provider: "openai",
    fallback_mode: "manual",
    pregen_enabled: false,
    discard_stale_speech_on_regenerated_reply: false,
    profiles: {
      openai: { base_url: "https://api.openai.com/v1", model: "gpt-4o-mini", preset: "openai", api_key_set: true }
    }
  };

  it("deletes an INACTIVE profile via a direct confirm → PUT { delete_profile } and closes the editor", async () => {
    let capturedBody: unknown;
    server.use(
      http.put(`${API_BASE_URL}/api/llm/provider`, async ({ request }) => {
        capturedBody = await request.json();
        return HttpResponse.json({ ...defaultLlmProvider, profiles: {} });
      })
    );
    renderCard();

    // Default fixture: openai is CONFIGURED but INACTIVE (active_provider="local").
    fireEvent.click(await screen.findByRole("button", { name: /OpenAI/ }));
    fireEvent.click(screen.getByRole("button", { name: "Eliminar proveedor" }));
    // Inactive → the plain "provider + key removed" confirm, no "switch to Local".
    expect(screen.getByText(/Se elimina el proveedor/)).toBeInTheDocument();
    expect(screen.queryByText(/cambia a Local/)).not.toBeInTheDocument();
    // The destructive advance carries the same label (the entry button is gone).
    fireEvent.click(screen.getByRole("button", { name: "Eliminar proveedor" }));

    await waitFor(() => expect(capturedBody).toEqual({ delete_profile: "openai" }));
    // Editor closed on success — the profile no longer exists.
    await waitFor(() => expect(screen.queryByLabelText("URL base")).not.toBeInTheDocument());
  });

  it("deletes the ACTIVE profile with the switch-then-delete PUT { active_provider: 'local', delete_profile }", async () => {
    let capturedBody: unknown;
    server.use(llmProviderGetHandler(activeFixture));
    server.use(
      http.put(`${API_BASE_URL}/api/llm/provider`, async ({ request }) => {
        capturedBody = await request.json();
        return HttpResponse.json({ ...activeFixture, active_provider: "local", profiles: {} });
      })
    );
    renderCard();

    fireEvent.click(await screen.findByRole("button", { name: /OpenAI/ }));
    fireEvent.click(screen.getByRole("button", { name: "Eliminar proveedor" }));
    // Active → the ergonomic single-PUT confirm copy the owner was promised.
    expect(screen.getByText(/Esto cambia a Local y elimina el proveedor/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Eliminar proveedor" }));

    await waitFor(() =>
      expect(capturedBody).toEqual({ active_provider: "local", delete_profile: "openai" })
    );
  });

  it("surfaces the mutual-exclusion 422 honestly through the design-system Alert (never weakened)", async () => {
    server.use(llmProviderValidationHandler("delete_profile cannot be combined with profile edits"));
    renderCard();

    fireEvent.click(await screen.findByRole("button", { name: /OpenAI/ }));
    fireEvent.click(screen.getByRole("button", { name: "Eliminar proveedor" }));
    fireEvent.click(screen.getByRole("button", { name: "Eliminar proveedor" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveClass("oc-alert");
    expect(alert).toHaveTextContent("No se puede combinar la eliminación con cambios del proveedor.");
  });

  it("keeps the 'cannot delete active profile' 422 intact (copy is honest, rule not weakened)", async () => {
    server.use(llmProviderValidationHandler("cannot delete active profile"));
    renderCard();

    fireEvent.click(await screen.findByRole("button", { name: /OpenAI/ }));
    fireEvent.click(screen.getByRole("button", { name: "Eliminar proveedor" }));
    fireEvent.click(screen.getByRole("button", { name: "Eliminar proveedor" }));

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(
        "No puedes eliminar el proveedor activo; cambia a Local primero."
      )
    );
  });
});

describe("ProviderCard duplicar perfil (owner wants multiple NVIDIA with different models)", () => {
  it("opens a prefilled custom editor: free id, source base_url/model/preset, and NO copied key", async () => {
    renderCard();

    fireEvent.click(await screen.findByRole("button", { name: /OpenAI/ }));
    fireEvent.click(screen.getByRole("button", { name: "Duplicar" }));

    // A free suggested id derived from the source (openai → openai_2).
    expect(screen.getByLabelText("Id del proveedor")).toHaveValue("openai_2");
    // Source identity is carried over…
    expect(screen.getByLabelText("URL base")).toHaveValue("https://api.openai.com/v1");
    expect(screen.getByLabelText("Modelo")).toHaveValue("gpt-4o-mini");
    expect(screen.getByLabelText("Preset")).toHaveTextContent("OpenAI");
    // …but the write-only api_key is NEVER copied: empty field, no stored-key badge.
    expect(screen.getByLabelText("API key")).toHaveValue("");
    expect(screen.queryByText("key guardada")).not.toBeInTheDocument();
    // The suggested id is valid, so Guardar is enabled straight away.
    expect(screen.getByRole("button", { name: "Guardar" })).toBeEnabled();
  });

  it("creates the duplicate via a profile-scoped PUT with the new id and no api_key", async () => {
    let capturedBody: any;
    server.use(
      http.put(`${API_BASE_URL}/api/llm/provider`, async ({ request }) => {
        capturedBody = await request.json();
        return HttpResponse.json(defaultLlmProvider);
      })
    );
    renderCard();

    fireEvent.click(await screen.findByRole("button", { name: /OpenAI/ }));
    fireEvent.click(screen.getByRole("button", { name: "Duplicar" }));
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));

    await waitFor(() => expect(capturedBody?.profile_id).toBe("openai_2"));
    expect(capturedBody.model).toBe("gpt-4o-mini");
    expect(capturedBody.base_url).toBe("https://api.openai.com/v1");
    // The source key is never re-sent — the new profile needs its own.
    expect(capturedBody).not.toHaveProperty("api_key");
  });
});

describe("ProviderCard error presentation (owner: 'la alerta es vaga, no usa los diseños que teníamos')", () => {
  it("renders provider errors with the design-system Alert (oc-alert), not a bare <p>", async () => {
    server.use(llmProviderValidationHandler("api_key required for active cloud profile"));
    renderCard();
    await screen.findByRole("combobox", { name: "Proveedor activo" });

    pickActiveProvider("OpenAI");

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveClass("oc-alert");
    // The honest copy assertion stays green through the component swap.
    expect(alert).toHaveTextContent("Para activar este proveedor en la nube falta la API key.");
  });
});

describe("ProviderCard with an active cloud profile that has no key", () => {
  const noKeyFixture: LlmProviderResponseFixture = {
    active_provider: "openai",
    fallback_mode: "manual",
    pregen_enabled: true,
    discard_stale_speech_on_regenerated_reply: false,
    profiles: {
      openai: { base_url: "https://api.openai.com/v1", model: "gpt-4o-mini", preset: "openai", api_key_set: false }
    }
  };

  it("reflects the active cloud provider and manual/pregen posture, and shows no stored-key badge", async () => {
    server.use(llmProviderGetHandler(noKeyFixture));
    renderCard();

    await waitFor(() =>
      expect(screen.getByRole("combobox", { name: "Proveedor activo" })).toHaveTextContent("OpenAI")
    );
    expect(screen.getByRole("button", { name: "Avisar y esperar" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("switch", { name: "Pregenerar respuestas en la nube" })).toHaveAttribute(
      "aria-checked",
      "true"
    );

    fireEvent.click(screen.getByRole("button", { name: /OpenAI/ }));
    expect(screen.queryByText("key guardada")).not.toBeInTheDocument();
  });
});

describe("ProviderCard guided setup (cloud-providers-vision P1)", () => {
  async function openGemini() {
    renderCard();
    fireEvent.click(await screen.findByRole("button", { name: /Agregar Google Gemini/ }));
  }

  it("lists the new providers from the backend presets", async () => {
    renderCard();
    expect(await screen.findByRole("button", { name: /Agregar DeepSeek/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Agregar Anthropic Claude/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Agregar OpenRouter/ })).toBeInTheDocument();
  });

  it("'Obtener key' opens the provider key page in the system browser", async () => {
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    await openGemini();
    fireEvent.click(screen.getByRole("button", { name: "Obtener key" }));
    expect(open).toHaveBeenCalledWith("https://aistudio.google.com/apikey", "_blank", "noreferrer");
    open.mockRestore();
  });

  it("'Probar' needs a key or a stored key", async () => {
    await openGemini();
    expect(screen.getByRole("button", { name: "Probar" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("API key"), { target: { value: "AQ.abc" } });
    expect(screen.getByRole("button", { name: "Probar" })).toBeEnabled();
  });

  it("tests the typed key, shows the model count and fills the model dropdown (recommended first)", async () => {
    const capture: { body?: unknown } = {};
    server.use(
      llmProviderTestHandler(
        {
          ok: true,
          error_code: null,
          models: ["zeta-model", "gemini-3.8-flash", "gemini-3.5-flash-lite"],
          recommended: ["gemini-3.5-flash-lite", "gemini-3.8-flash"]
        },
        capture
      )
    );
    await openGemini();
    fireEvent.change(screen.getByLabelText("API key"), { target: { value: "AQ.abc" } });
    fireEvent.click(screen.getByRole("button", { name: "Probar" }));

    expect(await screen.findByText("Key válida: 3 modelos disponibles")).toBeInTheDocument();
    expect(capture.body).toEqual({
      preset: "gemini",
      base_url: "https://generativelanguage.googleapis.com/v1beta/openai/",
      api_key: "AQ.abc",
      check_chat: true,
      model: "gemini-3.5-flash-lite"
    });
    fireEvent.click(screen.getByRole("combobox", { name: "Elegir modelo" }));
    const options = screen.getAllByRole("option").map((o) => (o.textContent ?? "").replace("✓", ""));
    expect(options).toEqual([
      "gemini-3.5-flash-lite (recomendado)",
      "gemini-3.8-flash (recomendado)",
      "zeta-model"
    ]);
    fireEvent.click(screen.getByRole("option", { name: "zeta-model" }));
    expect(screen.getByLabelText("Modelo")).toHaveValue("zeta-model");
  });

  it("states that the test spends a little balance", async () => {
    await openGemini();
    expect(
      screen.getByText(
        "Haremos una pregunta cortita al modelo para comprobar que responde (gasta muy poquito de tu saldo)."
      )
    ).toBeInTheDocument();
  });

  it("says the key works and the model answers when the chat stage passes", async () => {
    server.use(
      llmProviderTestHandler({ ok: true, error_code: null, models: ["m"], recommended: [], chat_ok: true, http_status: 200 })
    );
    await openGemini();
    fireEvent.change(screen.getByLabelText("API key"), { target: { value: "AQ.abc" } });
    fireEvent.click(screen.getByRole("button", { name: "Probar" }));
    expect(await screen.findByText("¡Listo! Tu API key funciona y el modelo responde.")).toBeInTheDocument();
  });

  it("explains a failed chat stage with the reason and HTTP detail", async () => {
    server.use(
      llmProviderTestHandler({
        ok: true,
        error_code: null,
        models: ["m"],
        recommended: [],
        chat_ok: false,
        chat_error_code: "cloud_rate_limit",
        http_status: 402,
        provider_message: "Insufficient balance"
      })
    );
    await openGemini();
    fireEvent.change(screen.getByLabelText("API key"), { target: { value: "AQ.abc" } });
    fireEvent.click(screen.getByRole("button", { name: "Probar" }));
    expect(
      await screen.findByText("La key es válida, pero no hay saldo o llegaste al límite del proveedor.")
    ).toBeInTheDocument();
    expect(screen.getByText("HTTP 402: Insufficient balance")).toBeInTheDocument();
  });

  it("tests a stored key by profile id without sending a key", async () => {
    const capture: { body?: unknown } = {};
    server.use(
      llmProviderTestHandler({ ok: true, error_code: null, models: ["gpt-4o"], recommended: [] }, capture)
    );
    renderCard();
    fireEvent.click(await screen.findByRole("button", { name: /OpenAI/ }));
    fireEvent.click(screen.getByRole("button", { name: "Probar" }));
    await screen.findByText("Key válida: 1 modelos disponibles");
    expect(capture.body).toEqual({
      preset: "openai",
      base_url: "https://api.openai.com/v1",
      profile_id: "openai",
      check_chat: true,
      model: "gpt-4o-mini"
    });
  });

  it.each([
    ["invalid_key", "La key no es válida. Revisa que la copiaste completa."],
    ["unreachable", "No se pudo conectar con el proveedor. Revisa tu conexión a internet."],
    ["rate_limited", "El proveedor pidió esperar un poco. Intenta de nuevo en un momento."],
    ["unexpected", "El proveedor respondió algo inesperado. Revisa la URL base en Avanzado."]
  ])("shows friendly copy for %s", async (code, copy) => {
    server.use(llmProviderTestHandler({ ok: false, error_code: code, models: [], recommended: [] }));
    await openGemini();
    fireEvent.change(screen.getByLabelText("API key"), { target: { value: "AQ.abc" } });
    fireEvent.click(screen.getByRole("button", { name: "Probar" }));
    expect(await screen.findByText(copy)).toBeInTheDocument();
  });

  it("falls back to the recommended list before any test and marks vision models", async () => {
    await openGemini();
    fireEvent.click(screen.getByRole("combobox", { name: "Elegir modelo" }));
    expect(screen.getAllByRole("option").map((o) => (o.textContent ?? "").replace("✓", ""))).toEqual([
      "gemini-3.5-flash-lite (recomendado)",
      "gemini-3.8-flash (recomendado)"
    ]);
    fireEvent.click(screen.getByRole("option", { name: /gemini-3.8-flash/ }));
    expect(screen.getByText("Ve imágenes")).toBeInTheDocument();
  });

  it("does not claim vision for a text-only model", async () => {
    renderCard();
    fireEvent.click(await screen.findByRole("button", { name: /Agregar DeepSeek/ }));
    fireEvent.click(screen.getByRole("combobox", { name: "Elegir modelo" }));
    fireEvent.click(screen.getByRole("option", { name: /deepseek-v4-pro/ }));
    expect(screen.queryByText("Ve imágenes")).not.toBeInTheDocument();
  });

  it("keeps base URL and the custom model id under 'Avanzado'", async () => {
    await openGemini();
    const advanced = screen.getByText("Avanzado").closest("details") as HTMLDetailsElement;
    expect(advanced).toContainElement(screen.getByLabelText("URL base"));
    expect(advanced).toContainElement(screen.getByLabelText("Modelo"));
  });

  it("never shows the typed key in the test result", async () => {
    server.use(llmProviderTestHandler({ ok: true, error_code: null, models: ["m"], recommended: [] }));
    await openGemini();
    fireEvent.change(screen.getByLabelText("API key"), { target: { value: "AQ.canary-key" } });
    fireEvent.click(screen.getByRole("button", { name: "Probar" }));
    await screen.findByText("Key válida: 1 modelos disponibles");
    expect(document.body.textContent).not.toContain("AQ.canary-key");
  });

  it("clears a profile preset to '(ninguno)' by sending preset: null and reflects null on reopen", async () => {
    let capturedBody: any;
    let currentOpenAi = { ...defaultLlmProvider.profiles.openai };
    server.use(
      http.get(`${API_BASE_URL}/api/llm/provider`, () =>
        HttpResponse.json({
          ...defaultLlmProvider,
          profiles: { openai: currentOpenAi }
        })
      ),
      http.put(`${API_BASE_URL}/api/llm/provider`, async ({ request }) => {
        capturedBody = await request.json();
        currentOpenAi = { ...currentOpenAi, preset: capturedBody.preset ?? null };
        return HttpResponse.json({
          ...defaultLlmProvider,
          profiles: { openai: currentOpenAi }
        });
      })
    );
    renderCard();

    fireEvent.click(await screen.findByRole("button", { name: /OpenAI/ }));
    expect(screen.getByLabelText("Preset")).toHaveTextContent("OpenAI");

    fireEvent.click(screen.getByLabelText("Preset"));
    fireEvent.click(screen.getByRole("option", { name: "(ninguno)" }));
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));

    await waitFor(() => expect(capturedBody?.profile_id).toBe("openai"));
    expect(capturedBody.preset).toBeNull();

    // Switch away to another row and reopen OpenAI -> reads the updated query cache (preset: null -> "(ninguno)")
    fireEvent.click(screen.getByRole("button", { name: /Agregar NVIDIA NIM/ }));
    fireEvent.click(screen.getByRole("button", { name: /OpenAI/ }));
    expect(screen.getByLabelText("Preset")).toHaveTextContent("(ninguno)");
  });
});

describe("ProviderCard Probar spinner & error transparency (S3)", () => {
  it("shows a spinner on Probar while the test is in flight and surfaces HTTP status on request failure", async () => {
    let releaseTest!: () => void;
    const gate = new Promise<void>((resolve) => { releaseTest = resolve; });
    server.use(
      http.post(`${API_BASE_URL}/api/llm/provider/test`, async () => {
        await gate;
        return HttpResponse.json({ detail: "Gateway Timeout" }, { status: 504 });
      })
    );
    renderCard();
    fireEvent.click(await screen.findByRole("button", { name: /OpenAI/ }));
    fireEvent.click(screen.getByRole("button", { name: "Probar" }));

    const pendingBtn = await screen.findByRole("button", { name: "Probando…" });
    expect(pendingBtn).toBeDisabled();
    expect(pendingBtn.querySelector("svg.animate-spin")).not.toBeNull();

    releaseTest();
    expect(await screen.findByText(/No se pudo conectar con el proveedor/)).toBeInTheDocument();
    expect(screen.getByText(/HTTP 504/)).toBeInTheDocument();
  });
});
