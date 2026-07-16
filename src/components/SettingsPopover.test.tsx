import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { server } from "../test/server.js";
import { API_BASE_URL, defaultI18nState, i18nStateHandler } from "../test/handlers.js";
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
});

afterEach(() => {
  window.localStorage.clear();
  delete document.documentElement.dataset.density;
  delete document.documentElement.dataset.alertStyle;
});

describe("SettingsPopover", () => {
  it("offers an explicit Welcome restore action", () => {
    const onShowWelcome = vi.fn();
    render(<SettingsPopover onShowWelcome={onShowWelcome} />);
    fireEvent.click(screen.getByRole("button", { name: "Configuración" }));

    fireEvent.click(screen.getByRole("button", { name: "Volver a ver bienvenida" }));

    expect(onShowWelcome).toHaveBeenCalledOnce();
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

  it("Mostrar logs is a client-only stub with a not-wired role=status note", () => {
    render(<SettingsPopover />);
    fireEvent.click(screen.getByRole("button", { name: "Configuración" }));

    const logs = screen.getByRole("switch", { name: "Mostrar logs" });
    expect(logs).toHaveAttribute("aria-checked", "false");

    fireEvent.click(logs);

    expect(logs).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("status")).toHaveTextContent("necesita streaming en vivo desde el backend");
  });

  it("Alertas section renders the segmented control defaulted to sereno plus a live preview", () => {
    render(<SettingsPopover />);
    fireEvent.click(screen.getByRole("button", { name: "Configuración" }));

    const group = screen.getByRole("group", { name: "Estilo de alertas" });
    expect(group).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sereno" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("alert")).toHaveTextContent("Elegí el estilo que más te acomode.");
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
});
