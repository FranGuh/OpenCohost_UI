import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { server } from "../../test/server.js";
import { API_BASE_URL, defaultI18nState, defaultPersonalization, i18nStateHandler } from "../../test/handlers.js";
import { useThemeStore } from "../../theme/useTheme.js";
import * as openUrl from "../../lib/openUrl.js";
import { useUiLocaleStore } from "../../i18n/locale.js";
import { useAvatarPresentationStore } from "../../store/avatarPresentationStore.js";
import { initialSetupState } from "./setupMachine.js";
import { AvatarStep, LiveAudioStep, PersonalizeIntroStep, ProfileStep, SearchStep, ThemeStep } from "./PersonalizeSteps.js";

function renderWith(ui: (dispatch: ReturnType<typeof vi.fn>) => JSX.Element) {
  const dispatch = vi.fn();
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={queryClient}>{ui(dispatch)}</QueryClientProvider>);
  return dispatch;
}

beforeEach(() => {
  window.localStorage.clear();
  useUiLocaleStore.getState().setLocale("es");
  useAvatarPresentationStore.setState({ mode: "2d", selectedModel: "" });
});

describe("PersonalizeIntroStep", () => {
  it("asks once, with a yes and a not-now answer that explains where to do it later", () => {
    const dispatch = renderWith((d) => <PersonalizeIntroStep dispatch={d} />);
    expect(screen.getByText("Puedes hacerlo luego en Controles o escribiendo /setup.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Sí, personalizar" }));
    expect(dispatch).toHaveBeenLastCalledWith({ type: "personalize", wants: true });
    fireEvent.click(screen.getByRole("button", { name: "Ahora no" }));
    expect(dispatch).toHaveBeenLastCalledWith({ type: "personalize", wants: false });
  });
});

describe("AvatarStep", () => {
  const state = { ...initialSetupState(), step: "avatar" as const, personalize: true };
  const withGpu = { ...state, hasGpu: true };

  it("picks Kira in 3D or the PNG images through the avatar presentation store", () => {
    renderWith((d) => <AvatarStep state={state} dispatch={d} />);
    fireEvent.click(screen.getByRole("button", { name: /Kira en 3D/ }));
    expect(useAvatarPresentationStore.getState().mode).toBe("3d");
    expect(screen.getByRole("button", { name: /Kira en 3D/ })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: /Imágenes PNG de Kira/ }));
    expect(useAvatarPresentationStore.getState().mode).toBe("2d");
    expect(screen.getByRole("button", { name: /Imágenes PNG de Kira/ })).toHaveAttribute("aria-pressed", "true");
  });

  it("recommends and preselects Kira in 3D when the PC has a usable GPU", () => {
    renderWith((d) => <AvatarStep state={withGpu} dispatch={d} />);
    const three = screen.getByRole("button", { name: /Kira en 3D/ });
    expect(three).toHaveTextContent("Recomendado");
    expect(three).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: /Imágenes PNG de Kira/ })).not.toHaveTextContent("Recomendado");
    expect(useAvatarPresentationStore.getState().mode).toBe("3d");
  });

  it("recommends the PNG images when there is no GPU or it is unknown", () => {
    renderWith((d) => <AvatarStep state={state} dispatch={d} />);
    const png = screen.getByRole("button", { name: /Imágenes PNG de Kira/ });
    expect(png).toHaveTextContent("Recomendado");
    expect(png).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: /Kira en 3D/ })).not.toHaveTextContent("Recomendado");
    expect(useAvatarPresentationStore.getState().mode).toBe("2d");
  });

  it("keeps a presentation the user already chose instead of overriding it with the recommendation", () => {
    useAvatarPresentationStore.getState().setMode("2d");
    renderWith((d) => <AvatarStep state={withGpu} dispatch={d} />);
    expect(screen.getByRole("button", { name: /Imágenes PNG de Kira/ })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: /Kira en 3D/ })).toHaveTextContent("Recomendado");
  });

  it("only notes where to upload an own avatar: no selectable 'own' choice", () => {
    renderWith((d) => <AvatarStep state={state} dispatch={d} />);
    expect(screen.queryByRole("button", { name: "Usar el mío" })).not.toBeInTheDocument();
    expect(screen.getAllByRole("button")).toHaveLength(2);
    expect(screen.getByText("Después puedes subir tu propio avatar (PNG o VRM) en Controles › Avatar.")).toBeInTheDocument();
  });

  it("has no separate skip: the choice applies at once and the footer Continue moves on", () => {
    renderWith((d) => <AvatarStep state={state} dispatch={d} />);
    expect(screen.queryByRole("button", { name: "Saltar" })).not.toBeInTheDocument();
  });
});

describe("ProfileStep", () => {
  const state = { ...initialSetupState(), step: "profile" as const, personalize: true };

  it("saves nickname, occupation and interests and turns personalization on the first time", async () => {
    const bodies: unknown[] = [];
    server.use(
      http.put(`${API_BASE_URL}/api/personalization`, async ({ request }) => {
        const body = await request.json();
        bodies.push(body);
        return HttpResponse.json({ ...(body as object), custom_instructions: "", updated_at: null });
      })
    );
    const dispatch = renderWith((d) => <ProfileStep state={state} dispatch={d} />);
    fireEvent.change(screen.getByLabelText("¿Cómo quieres que te llame Kira?"), { target: { value: "  Tavo " } });
    fireEvent.change(screen.getByLabelText("A qué te dedicas (opcional)"), { target: { value: "Streamer" } });
    fireEvent.change(screen.getByLabelText("Tus intereses (opcional)"), { target: { value: "Juegos" } });
    // Let i18n + stored (never configured) record finish loading before Save unlocks.
    await waitFor(() => expect(screen.getByRole("button", { name: "Guardar y seguir" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Guardar y seguir" }));
    await waitFor(() => expect(dispatch).toHaveBeenCalledWith({ type: "next" }));
    expect(bodies).toEqual([{ enabled: true, nickname: "Tavo", occupation: "Streamer", interests: "Juegos" }]);
  });

  it("never touches the on/off switch of a personalization that was already configured", async () => {
    const bodies: unknown[] = [];
    server.use(
      http.get(`${API_BASE_URL}/api/personalization`, () =>
        HttpResponse.json({ enabled: false, nickname: "Old", occupation: "", interests: "", custom_instructions: "", updated_at: "2026-11-01T00:00:00Z" })
      ),
      http.put(`${API_BASE_URL}/api/personalization`, async ({ request }) => {
        const body = await request.json();
        bodies.push(body);
        return HttpResponse.json({ enabled: false, ...(body as object), custom_instructions: "", updated_at: "2026-11-12T00:00:00Z" });
      })
    );
    const dispatch = renderWith((d) => <ProfileStep state={state} dispatch={d} />);
    await waitFor(() => expect(screen.getByLabelText("¿Cómo quieres que te llame Kira?")).toHaveValue("Old"));
    fireEvent.change(screen.getByLabelText("¿Cómo quieres que te llame Kira?"), { target: { value: "Tavo" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar y seguir" }));
    await waitFor(() => expect(dispatch).toHaveBeenCalledWith({ type: "next" }));
    expect(bodies).toEqual([{ nickname: "Tavo", occupation: "", interests: "" }]);
  });

  it("limits the fields to the server caps and saves when any field is filled", async () => {
    renderWith((d) => <ProfileStep state={state} dispatch={d} />);
    expect(screen.getByLabelText("¿Cómo quieres que te llame Kira?")).toHaveAttribute("maxlength", "60");
    expect(screen.getByLabelText("A qué te dedicas (opcional)")).toHaveAttribute("maxlength", "120");
    expect(screen.getByLabelText("Tus intereses (opcional)")).toHaveAttribute("maxlength", "240");
    expect(screen.getByRole("button", { name: "Guardar y seguir" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Tus intereses (opcional)"), { target: { value: "Juegos" } });
    await waitFor(() => expect(screen.getByRole("button", { name: "Guardar y seguir" })).toBeEnabled());
  });

  it("'Saltar' skips without writing anything", async () => {
    const writes: string[] = [];
    server.use(http.put(`${API_BASE_URL}/api/personalization`, () => { writes.push("put"); return HttpResponse.json({}); }));
    const dispatch = renderWith((d) => <ProfileStep state={state} dispatch={d} />);
    expect(screen.queryByRole("button", { name: "Configurar después" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Saltar" }));
    expect(dispatch).toHaveBeenCalledWith({ type: "next" });
    expect(writes).toEqual([]);
  });

  it("points to Perfiles for the character instead of embedding the editor", () => {
    renderWith((d) => <ProfileStep state={state} dispatch={d} />);
    expect(screen.getByText(/abre Perfiles/)).toBeInTheDocument();
  });

  it("binds to persisted_locale ?? active_locale during onboarding (reads and writes ?locale=en)", async () => {
    const getLocales: string[] = [];
    const putLocales: string[] = [];
    server.use(
      i18nStateHandler({ ...defaultI18nState, active_locale: "es", persisted_locale: "en-US", pending_restart: true }),
      http.get(`${API_BASE_URL}/api/personalization`, ({ request }) => {
        getLocales.push(new URL(request.url).searchParams.get("locale") ?? "missing");
        return HttpResponse.json(defaultPersonalization);
      }),
      http.put(`${API_BASE_URL}/api/personalization`, async ({ request }) => {
        putLocales.push(new URL(request.url).searchParams.get("locale") ?? "missing");
        const body = (await request.json()) as object;
        return HttpResponse.json({ ...defaultPersonalization, ...body, updated_at: "2026-11-15T18:00:00Z" });
      })
    );

    const dispatch = renderWith((d) => <ProfileStep state={state} dispatch={d} />);
    await waitFor(() => expect(getLocales).toEqual(["en"]));
    fireEvent.change(screen.getByLabelText("¿Cómo quieres que te llame Kira?"), { target: { value: "Tavo" } });
    await waitFor(() => expect(screen.getByRole("button", { name: "Guardar y seguir" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Guardar y seguir" }));
    await waitFor(() => expect(dispatch).toHaveBeenCalledWith({ type: "next" }));
    expect(putLocales).toEqual(["en"]);
  });

  it("guards Save while personalization is still loading so updated_at === null cannot race and drop enabled: true", async () => {
    let resolveGet!: () => void;
    const gate = new Promise<void>((resolve) => {
      resolveGet = resolve;
    });
    const bodies: unknown[] = [];
    server.use(
      http.get(`${API_BASE_URL}/api/personalization`, async () => {
        await gate;
        return HttpResponse.json(defaultPersonalization);
      }),
      http.put(`${API_BASE_URL}/api/personalization`, async ({ request }) => {
        const body = await request.json();
        bodies.push(body);
        return HttpResponse.json({ ...defaultPersonalization, ...(body as object), updated_at: "2026-11-15T18:00:00Z" });
      })
    );

    const dispatch = renderWith((d) => <ProfileStep state={state} dispatch={d} />);
    fireEvent.change(screen.getByLabelText("¿Cómo quieres que te llame Kira?"), { target: { value: "Tavo" } });
    expect(screen.getByRole("button", { name: "Guardar y seguir" })).toBeDisabled();

    resolveGet();
    await waitFor(() => expect(screen.getByRole("button", { name: "Guardar y seguir" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Guardar y seguir" }));
    await waitFor(() => expect(dispatch).toHaveBeenCalledWith({ type: "next" }));
    expect(bodies).toEqual([{ enabled: true, nickname: "Tavo", occupation: "", interests: "" }]);
  });

  it("renders a clear Kira-locale badge and mismatch note when UI locale differs from Kira's backend locale without mixing es/en data", async () => {
    useUiLocaleStore.getState().setLocale("en");
    const getLocales: string[] = [];
    server.use(
      i18nStateHandler({ ...defaultI18nState, active_locale: "es", persisted_locale: "es", pending_restart: false }),
      http.get(`${API_BASE_URL}/api/personalization`, ({ request }) => {
        const loc = new URL(request.url).searchParams.get("locale") ?? "missing";
        getLocales.push(loc);
        return HttpResponse.json(
          loc === "es"
            ? { ...defaultPersonalization, nickname: "FranGuh", updated_at: "2026-11-01T00:00:00Z" }
            : defaultPersonalization
        );
      })
    );

    renderWith((d) => <ProfileStep state={state} dispatch={d} />);
    await waitFor(() => expect(getLocales).toEqual(["es"]));
    expect(await screen.findByDisplayValue("FranGuh")).toBeInTheDocument();
    expect(screen.getByText("Kira profile language: Español")).toBeInTheDocument();
    expect(screen.getByText(/The app interface is in English, while this profile is for Kira's language \(Español\)\./)).toBeInTheDocument();
  });
});

describe("SearchStep", () => {
  const state = { ...initialSetupState(), step: "search" as const, personalize: true };

  function tavily(initial: { stored_key_set: boolean }) {
    const puts: unknown[] = [];
    let stored = initial.stored_key_set;
    const status = () => ({
      api_key_set: stored, stored_key_set: stored, storage_available: true, source: stored ? "keyring" : "none"
    });
    server.use(
      http.get(`${API_BASE_URL}/api/web-fetch/tavily`, () => HttpResponse.json(status())),
      http.put(`${API_BASE_URL}/api/web-fetch/tavily`, async ({ request }) => {
        puts.push(await request.json());
        stored = true;
        return HttpResponse.json(status());
      })
    );
    return puts;
  }

  it("asks only for the optional Tavily key, saves it write-only and has nothing about voice or theme", async () => {
    const puts = tavily({ stored_key_set: false });
    const dispatch = renderWith((d) => <SearchStep state={state} dispatch={d} />);
    expect(screen.getByText(/Kira ya puede buscar en internet/)).toBeInTheDocument();
    expect(screen.queryByText(/LiveAudio/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Studio" })).not.toBeInTheDocument();
    const input = await screen.findByLabelText("API key de Tavily (opcional)");
    expect(input).toHaveAttribute("type", "password");
    expect(screen.getByRole("button", { name: "Guardar y seguir" })).toBeDisabled();
    fireEvent.change(input, { target: { value: "tvly-secret" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar y seguir" }));
    await waitFor(() => expect(dispatch).toHaveBeenCalledWith({ type: "next" }));
    expect(puts).toEqual([{ api_key: "tvly-secret" }]);
    expect(screen.getByLabelText("API key de Tavily (opcional)")).toHaveValue("");
    expect(document.body.textContent).not.toContain("tvly-secret");
  });

  it("stays on the screen with an error when the key cannot be saved", async () => {
    server.use(
      http.get(`${API_BASE_URL}/api/web-fetch/tavily`, () =>
        HttpResponse.json({ api_key_set: false, stored_key_set: false, storage_available: true, source: "none" })
      ),
      http.put(`${API_BASE_URL}/api/web-fetch/tavily`, () => new HttpResponse(null, { status: 500 }))
    );
    const dispatch = renderWith((d) => <SearchStep state={state} dispatch={d} />);
    fireEvent.change(await screen.findByLabelText("API key de Tavily (opcional)"), { target: { value: "tvly-secret" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar y seguir" }));
    expect(await screen.findByText("No pude guardar la API key.")).toBeInTheDocument();
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("'Saltar' discards a typed key without saving it", async () => {
    const puts = tavily({ stored_key_set: false });
    const dispatch = renderWith((d) => <SearchStep state={state} dispatch={d} />);
    fireEvent.change(await screen.findByLabelText("API key de Tavily (opcional)"), { target: { value: "tvly-secret" } });
    fireEvent.click(screen.getByRole("button", { name: "Saltar" }));
    expect(dispatch).toHaveBeenCalledWith({ type: "next" });
    expect(puts).toEqual([]);
  });

  it("shows only 'guardada' when a key is already stored", async () => {
    tavily({ stored_key_set: true });
    renderWith((d) => <SearchStep state={state} dispatch={d} />);
    expect(await screen.findByText("API key guardada")).toBeInTheDocument();
    expect(screen.getByLabelText("API key de Tavily (opcional)")).toHaveValue("");
  });

  it("links to Tavily through the external opener", async () => {
    tavily({ stored_key_set: false });
    const open = vi.spyOn(openUrl, "openExternalUrl").mockResolvedValue(true);
    renderWith((d) => <SearchStep state={state} dispatch={d} />);
    fireEvent.click(screen.getByRole("link", { name: /Conseguir una API key de Tavily/ }));
    expect(open).toHaveBeenLastCalledWith("https://app.tavily.com");
    open.mockRestore();
  });
});

describe("LiveAudioStep", () => {
  it("is an info screen: the note and the download link, no input and no choice", () => {
    const open = vi.spyOn(openUrl, "openExternalUrl").mockResolvedValue(true);
    renderWith(() => <LiveAudioStep />);
    expect(screen.getByText(/Para hablarle con tu voz instala LiveAudio/)).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("link", { name: /Descargar LiveAudio/ }));
    expect(open).toHaveBeenLastCalledWith(expect.stringContaining("liveaudio.opencohost.com"));
    open.mockRestore();
  });
});

describe("ThemeStep", () => {
  it("offers only the theme picker", () => {
    renderWith(() => <ThemeStep />);
    fireEvent.click(screen.getByRole("button", { name: "Studio" }));
    expect(useThemeStore.getState().theme).toBe("studio");
    expect(screen.queryByLabelText("API key de Tavily (opcional)")).not.toBeInTheDocument();
  });
});
