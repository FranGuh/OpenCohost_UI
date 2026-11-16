import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { server } from "../../test/server.js";
import { API_BASE_URL, defaultI18nState, i18nStateHandler } from "../../test/handlers.js";
import { useLogsPrefStore } from "../../store/useLogsPref.js";
import { useUiLocaleStore } from "../../i18n/locale.js";
import { reloadBackend } from "../../lib/backendControl.js";
vi.mock("../../lib/backendControl.js", () => ({ reloadBackend: vi.fn() }));

const openExternalUrl = vi.fn().mockResolvedValue(true);

vi.mock("../../lib/openUrl.js", () => ({
  openExternalUrl: (url: string) => openExternalUrl(url)
}));

import {
  SettingsPopover as SettingsPopoverComponent,
  type SettingsPopoverProps
} from "./SettingsPopover.js";

function SettingsPopover({ onShowWelcome = () => {} }: Partial<SettingsPopoverProps>) {
  return <SettingsPopoverComponent onShowWelcome={onShowWelcome} />;
}

beforeEach(() => {
  window.localStorage.clear();
  delete document.documentElement.dataset.density;
  delete document.documentElement.dataset.alertStyle;
  // The logs pref and the UI locale are module singletons — reset them so
  // tests don't leak state into each other.
  useLogsPrefStore.setState({ showLogs: false });
  useUiLocaleStore.setState({ locale: "es" });
  document.documentElement.lang = "es";
});

afterEach(() => {
  window.localStorage.clear();
  delete document.documentElement.dataset.density;
  delete document.documentElement.dataset.alertStyle;
  document.documentElement.lang = "es";
});

describe("SettingsPopover", () => {
  it("offers an explicit Welcome restore action", () => {
    const onShowWelcome = vi.fn();
    render(<SettingsPopover onShowWelcome={onShowWelcome} />);
    fireEvent.click(screen.getByRole("button", { name: "Configuración" }));

    fireEvent.click(screen.getByRole("button", { name: "Volver a ver bienvenida" }));

    expect(onShowWelcome).toHaveBeenCalledOnce();
  });

  it("offers a Report an issue button that opens GitHub issues", () => {
    render(<SettingsPopover />);
    fireEvent.click(screen.getByRole("button", { name: "Configuración" }));

    const reportBtn = screen.getByRole("button", { name: "Reportar un problema en GitHub" });
    expect(reportBtn).toBeInTheDocument();
    fireEvent.click(reportBtn);

    expect(openExternalUrl).toHaveBeenCalledWith("https://github.com/plynte-labs/OpenCohost/issues/new");
  });

  it("is closed by default with aria-expanded false and no panel in the DOM", () => {
    render(<SettingsPopover />);
    const trigger = screen.getByRole("button", { name: "Configuración" });
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("group", { name: "Tema" })).not.toBeInTheDocument();
  });

  it("opens the panel on trigger click and marks aria-expanded true", () => {
    render(<SettingsPopover />);
    const trigger = screen.getByRole("button", { name: "Configuración" });

    fireEvent.click(trigger);

    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("group", { name: "Tema" })).toBeInTheDocument();
  });

  it("closes on Escape", () => {
    render(<SettingsPopover />);
    const trigger = screen.getByRole("button", { name: "Configuración" });
    fireEvent.click(trigger);
    expect(screen.getByRole("group", { name: "Tema" })).toBeInTheDocument();

    fireEvent.keyDown(document, { key: "Escape" });

    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("group", { name: "Tema" })).not.toBeInTheDocument();
  });

  it("closes on outside click", () => {
    render(
      <div>
        <SettingsPopover />
        <button type="button">afuera</button>
      </div>
    );
    fireEvent.click(screen.getByRole("button", { name: "Configuración" }));
    expect(screen.getByRole("group", { name: "Tema" })).toBeInTheDocument();

    fireEvent.mouseDown(screen.getByRole("button", { name: "afuera" }));

    expect(screen.queryByRole("group", { name: "Tema" })).not.toBeInTheDocument();
  });

  it("Compacto toggles data-density on <html> and persists it to localStorage", () => {
    render(<SettingsPopover />);
    fireEvent.click(screen.getByRole("button", { name: "Configuración" }));

    const compacto = screen.getByRole("switch", { name: "Compacto" });
    expect(compacto).toHaveAttribute("aria-checked", "false");
    expect(document.documentElement.dataset.density).toBeUndefined();

    fireEvent.click(compacto);

    expect(compacto).toHaveAttribute("aria-checked", "true");
    expect(document.documentElement.dataset.density).toBe("compact");
    expect(window.localStorage.getItem("oc-density")).toBe("compact");
  });

  it("Mostrar logs persists the preference to localStorage and drops the not-wired stub copy (R36)", () => {
    render(<SettingsPopover />);
    fireEvent.click(screen.getByRole("button", { name: "Configuración" }));

    const logs = screen.getByRole("switch", { name: "Mostrar logs" });
    expect(logs).toHaveAttribute("aria-checked", "false");
    // The Logs tab has a real data source now — the old "no existe ese endpoint"
    // stub copy must be gone.
    expect(screen.queryByText(/necesita streaming en vivo desde el backend/)).not.toBeInTheDocument();

    fireEvent.click(logs);

    expect(logs).toHaveAttribute("aria-checked", "true");
    expect(window.localStorage.getItem("oc-show-logs")).toBe("1");
  });

  it("reflects the persisted Mostrar logs preference across a remount (R36)", () => {
    useLogsPrefStore.getState().setShowLogs(true);
    render(<SettingsPopover />);
    fireEvent.click(screen.getByRole("button", { name: "Configuración" }));

    expect(screen.getByRole("switch", { name: "Mostrar logs" })).toHaveAttribute("aria-checked", "true");
  });

  it("Alertas section renders the segmented control defaulted to sereno plus a live preview", () => {
    render(<SettingsPopover />);
    fireEvent.click(screen.getByRole("button", { name: "Configuración" }));

    const group = screen.getByRole("group", { name: "Estilo de alertas" });
    expect(group).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sereno" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("alert")).toHaveTextContent("Elige el estilo que más te acomode.");
  });

  it("switching Alertas style updates data-alert-style and persists it to localStorage", () => {
    render(<SettingsPopover />);
    fireEvent.click(screen.getByRole("button", { name: "Configuración" }));

    fireEvent.click(screen.getByRole("button", { name: "Marcado" }));

    expect(screen.getByRole("button", { name: "Marcado" })).toHaveAttribute("aria-pressed", "true");
    expect(document.documentElement.dataset.alertStyle).toBe("marcado");
    expect(window.localStorage.getItem("oc-alert-style")).toBe("marcado");
  });

  it("opens the 5 Ayuda topics in a lateral flyout only after the trigger is toggled", () => {
    render(<SettingsPopover />);
    fireEvent.click(screen.getByRole("button", { name: "Configuración" }));

    const help = screen.getByRole("button", { name: "Ayuda" });
    expect(help).toHaveAttribute("aria-expanded", "false");
    // Collapsed: the help content is not rendered (no downward growth).
    expect(screen.queryByText("Experiencia")).not.toBeInTheDocument();

    fireEvent.click(help);

    expect(help).toHaveAttribute("aria-expanded", "true");
    expect(help).toHaveAttribute("aria-controls", "settings-help-flyout");
    const flyout = document.getElementById("settings-help-flyout");
    expect(flyout).not.toBeNull();
    // Anchored to the popover's left edge (leftward), not stacked below it.
    expect(flyout).toHaveClass("right-full");
    for (const title of ["Experiencia", "Controles", "Agenda", "Stream", "Música"]) {
      expect(screen.getByText(title)).toBeInTheDocument();
    }
  });

  it("collapses the Ayuda flyout when the trigger is toggled again", () => {
    render(<SettingsPopover />);
    fireEvent.click(screen.getByRole("button", { name: "Configuración" }));

    const help = screen.getByRole("button", { name: "Ayuda" });
    fireEvent.click(help);
    expect(screen.getByText("Experiencia")).toBeInTheDocument();

    fireEvent.click(help);
    expect(help).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("Experiencia")).not.toBeInTheDocument();
  });
});

describe("SettingsPopover Idioma card (GET/PUT /api/i18n, D6 next-boot only)", () => {
  it("renders the locales as a segmented row (≤3), with the persisted locale pressed", async () => {
    render(<SettingsPopover />);
    fireEvent.click(screen.getByRole("button", { name: "Configuración" }));

    await waitFor(() => expect(screen.getByRole("group", { name: "Idioma" })).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Español" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "English" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "English" })).toHaveAttribute("aria-pressed", "false");
  });

  it("shows no restart badge when pending_restart is false (default)", async () => {
    render(<SettingsPopover />);
    fireEvent.click(screen.getByRole("button", { name: "Configuración" }));

    await waitFor(() => expect(screen.getByRole("group", { name: "Idioma" })).toBeInTheDocument());
    expect(screen.queryByText(/Reinicio requerido/)).not.toBeInTheDocument();
  });

  it("shows the restart badge when GET /api/i18n reports pending_restart:true", async () => {
    server.use(
      i18nStateHandler({ ...defaultI18nState, persisted_locale: "en", pending_restart: true })
    );
    render(<SettingsPopover />);
    fireEvent.click(screen.getByRole("button", { name: "Configuración" }));

    await waitFor(() => expect(screen.getByText(/Reinicio requerido/)).toBeInTheDocument());
  });

  it("warns what the pending restart applies and what it ends, with a Restart to apply button", async () => {
    server.use(i18nStateHandler({ ...defaultI18nState, persisted_locale: "en", pending_restart: true }));
    vi.mocked(reloadBackend).mockResolvedValue({ ok: true });
    render(<SettingsPopover />);
    fireEvent.click(screen.getByRole("button", { name: "Configuración" }));

    expect(await screen.findByText(/Kira hablará en el nuevo idioma después de reiniciar/)).toBeInTheDocument();
    expect(screen.getByText(/cierra la conversación en curso/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Reiniciar para aplicar" }));
    await waitFor(() => expect(reloadBackend).toHaveBeenCalledTimes(1));
  });

  it("shows no Restart to apply button when no restart is pending", async () => {
    render(<SettingsPopover />);
    fireEvent.click(screen.getByRole("button", { name: "Configuración" }));
    await waitFor(() => expect(screen.getByRole("group", { name: "Idioma" })).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: "Reiniciar para aplicar" })).not.toBeInTheDocument();
  });

  it("selecting a language PUTs /api/i18n and reflects the returned pending_restart badge", async () => {
    let capturedBody: unknown;
    server.use(
      http.put(`${API_BASE_URL}/api/i18n`, async ({ request }) => {
        capturedBody = await request.json();
        return HttpResponse.json({ ...defaultI18nState, persisted_locale: "en", pending_restart: true });
      })
    );
    render(<SettingsPopover />);
    fireEvent.click(screen.getByRole("button", { name: "Configuración" }));
    await waitFor(() => expect(screen.getByRole("group", { name: "Idioma" })).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "English" }));

    await waitFor(() => expect(capturedBody).toEqual({ locale: "en" }));
    await waitFor(() => expect(screen.getByText(/Reinicio requerido/)).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "English" })).toHaveAttribute("aria-pressed", "true");
  });

  it("syncs the shared [\"i18n\"] React Query cache immediately on locale change when mounted under QueryClientProvider", async () => {
    const nextState = { ...defaultI18nState, persisted_locale: "en", pending_restart: true };
    server.use(
      http.put(`${API_BASE_URL}/api/i18n`, () => HttpResponse.json(nextState))
    );
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    queryClient.setQueryData(["i18n"], defaultI18nState);

    render(
      <QueryClientProvider client={queryClient}>
        <SettingsPopover />
      </QueryClientProvider>
    );
    fireEvent.click(screen.getByRole("button", { name: "Configuración" }));
    await waitFor(() => expect(screen.getByRole("group", { name: "Idioma" })).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "English" }));

    await waitFor(() => expect(queryClient.getQueryData(["i18n"])).toEqual(nextState));
  });
});

describe("SettingsPopover Idioma card — interface locale (E0, local-only, no backend call)", () => {
  it("renders a distinct 'Idioma de la interfaz' control defaulted to ES, alongside the existing Idioma control", async () => {
    render(<SettingsPopover />);
    fireEvent.click(screen.getByRole("button", { name: "Configuración" }));

    await waitFor(() => expect(screen.getByRole("group", { name: "Idioma" })).toBeInTheDocument());
    const interfaceGroup = screen.getByRole("group", { name: "Idioma de la interfaz" });
    expect(interfaceGroup).toBeInTheDocument();
    expect(screen.getByText("Interfaz")).toBeInTheDocument();
    expect(screen.getByText("Voz de Kira")).toBeInTheDocument();
    expect(within(interfaceGroup).getByRole("button", { name: "ES" })).toHaveAttribute("aria-pressed", "true");
    expect(within(interfaceGroup).getByRole("button", { name: "EN" })).toHaveAttribute("aria-pressed", "false");
  });

  it("flipping the interface control updates document.documentElement.lang and localStorage, without calling the backend", async () => {
    let putCalled = false;
    server.use(
      http.put(`${API_BASE_URL}/api/i18n`, async () => {
        putCalled = true;
        return HttpResponse.json(defaultI18nState);
      })
    );
    render(<SettingsPopover />);
    fireEvent.click(screen.getByRole("button", { name: "Configuración" }));
    await waitFor(() => expect(screen.getByRole("group", { name: "Idioma" })).toBeInTheDocument());

    const interfaceGroup = screen.getByRole("group", { name: "Idioma de la interfaz" });
    fireEvent.click(within(interfaceGroup).getByRole("button", { name: "EN" }));

    expect(document.documentElement.lang).toBe("en");
    expect(window.localStorage.getItem("oc-ui-locale")).toBe("en");
    // A synchronous check right after the click can never observe a
    // fire-and-forget PUT — it hasn't had a chance to resolve yet, so it would
    // read `false` no matter what the code does. Give it a real window to land
    // (waitFor polls) and require that window to time out, i.e. that the PUT
    // never happens at all, not just that it hasn't happened yet.
    let putEventuallyFired = true;
    try {
      await waitFor(() => expect(putCalled).toBe(true), { timeout: 200 });
    } catch {
      putEventuallyFired = false;
    }
    expect(putEventuallyFired).toBe(false);
    // The backend "Voz de Kira" control is untouched by the interface flip.
    expect(screen.queryByText(/Reinicio requerido/)).not.toBeInTheDocument();
  });

  it("survives a failing GET /api/i18n — the interface control renders, only the Kira row is withheld", async () => {
    // The interface locale is local-only, so an unreachable or erroring backend
    // must not take its control down along with the backend-driven row.
    let getCalled = false;
    server.use(
      http.get(`${API_BASE_URL}/api/i18n`, () => {
        getCalled = true;
        return HttpResponse.json({ detail: "boom" }, { status: 500 });
      })
    );
    render(<SettingsPopover />);
    fireEvent.click(screen.getByRole("button", { name: "Configuración" }));

    // Wait until the failure has actually been observed, so the assertions
    // below describe the post-failure state rather than a pre-fetch race.
    await waitFor(() => expect(getCalled).toBe(true));

    const interfaceGroup = await screen.findByRole("group", { name: "Idioma de la interfaz" });
    expect(within(interfaceGroup).getByRole("button", { name: "ES" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(within(interfaceGroup).getByRole("button", { name: "EN" }));
    expect(document.documentElement.lang).toBe("en");

    expect(screen.queryByRole("group", { name: "Idioma" })).not.toBeInTheDocument();
    expect(screen.queryByText("Voz de Kira")).not.toBeInTheDocument();
  });

  it("keeps the panel and the help flyout inside the viewport (internal scroll, capped size)", () => {
    render(<SettingsPopover />);
    fireEvent.click(screen.getByRole("button", { name: "Configuración" }));
    fireEvent.click(screen.getByRole("button", { name: "Ayuda" }));

    const panel = document.getElementById("settings-popover-panel");
    expect(panel).toHaveClass("max-w-[calc(100vw-2rem)]");
    const scroller = panel?.firstElementChild;
    expect(scroller).toHaveClass("max-h-[calc(100vh-4rem)]", "overflow-y-auto", "overflow-x-hidden");
    const flyout = document.getElementById("settings-help-flyout");
    expect(flyout).toHaveClass("max-h-[calc(100vh-4rem)]", "overflow-y-auto", "overflow-x-hidden");
    // Narrow windows: the flyout overlays the panel instead of leaving the screen.
    expect(flyout).toHaveClass("max-sm:inset-0");
  });

  it("shows the running version from the API in the panel header, not a hardcoded label", async () => {
    server.use(
      http.get(`${API_BASE_URL}/api/update`, () =>
        HttpResponse.json({ enabled: true, current: "0.7.3", latest: null, newer: false, url: null })
      )
    );
    render(<SettingsPopover />);
    fireEvent.click(screen.getByRole("button", { name: "Configuración" }));

    expect(await screen.findByText("v0.7.3")).toBeInTheDocument();
  });

  it("shows the running version and the update-check switch bound to PUT /api/update/config", async () => {
    let body: unknown = null;
    server.use(
      http.get(`${API_BASE_URL}/api/update`, () =>
        HttpResponse.json({ enabled: true, current: "0.5.0", latest: "0.5.0", newer: false, url: null })
      ),
      http.put(`${API_BASE_URL}/api/update/config`, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ enabled: false });
      })
    );
    render(<SettingsPopover />);
    fireEvent.click(screen.getByRole("button", { name: "Configuración" }));

    expect(await screen.findByText("Versión 0.5.0")).toBeInTheDocument();
    const toggle = await screen.findByRole("switch", { name: "Buscar actualizaciones al iniciar" });
    await waitFor(() => expect(toggle).toBeChecked());
    fireEvent.click(toggle);
    await waitFor(() => expect(body).toEqual({ enabled: false }));
    expect(toggle).not.toBeChecked();
  });

  it("rolls the update switch back when the save fails", async () => {
    server.use(
      http.get(`${API_BASE_URL}/api/update`, () =>
        HttpResponse.json({ enabled: true, current: "0.5.0", latest: null, newer: false, url: null })
      ),
      http.put(`${API_BASE_URL}/api/update/config`, () => HttpResponse.json({ detail: "x" }, { status: 503 }))
    );
    render(<SettingsPopover />);
    fireEvent.click(screen.getByRole("button", { name: "Configuración" }));
    const toggle = await screen.findByRole("switch", { name: "Buscar actualizaciones al iniciar" });
    await waitFor(() => expect(toggle).toBeChecked());
    fireEvent.click(toggle);
    await waitFor(() => expect(toggle).toBeChecked());
  });
});
