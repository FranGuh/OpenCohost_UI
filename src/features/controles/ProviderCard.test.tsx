import { http, HttpResponse } from "msw";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { describe, expect, it } from "vitest";
import { server } from "../../test/server.js";
import {
  API_BASE_URL,
  defaultLlmProvider,
  llmProviderGetErrorHandler,
  llmProviderGetHandler,
  llmProviderRouteMissingHandler,
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
        "El backend en ejecución todavía no tiene proveedores en la nube — cerrá y volvé a abrir la app."
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
    expect(screen.getByText(/Usá minúsculas, números y guion bajo/)).toBeInTheDocument();
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
        "No se pudo guardar la API key en el almacén seguro. Probá de nuevo."
      )
    );
  });
});

describe("ProviderCard delete-key on the ACTIVE cloud profile (owner: 'no deja editar' after borrar key)", () => {
  const activeKeyedFixture: LlmProviderResponseFixture = {
    active_provider: "openai",
    fallback_mode: "manual",
    pregen_enabled: false,
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
        "Para borrar la key del proveedor activo, primero cambiá a Local u otro proveedor."
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
        "No podés eliminar el proveedor activo; cambiá a Local primero."
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
