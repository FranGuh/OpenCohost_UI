import { http, HttpResponse } from "msw";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import React from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ProfileSwitchProvider } from "../../api/useProfileSwitch.js";
import { useUiLocaleStore } from "../../i18n/locale.js";
import { server } from "../../test/server.js";
import { API_BASE_URL } from "../../test/handlers.js";
import { ControlsPanel } from "./ControlsPanel.js";

beforeEach(() => {
  window.localStorage.clear();
  useUiLocaleStore.setState({ locale: "es" });
});

afterEach(() => {
  useUiLocaleStore.setState({ locale: "es" });
});

function renderPanel() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    React.createElement(
      QueryClientProvider,
      { client: queryClient },
      React.createElement(ProfileSwitchProvider, null, React.createElement(ControlsPanel))
    )
  );
}

describe("ControlsPanel — PaneSwitcher over the six settings groups", () => {
  it("renders a Segmented switcher (aria-pressed), not the old accordion (aria-expanded)", () => {
    renderPanel();
    const segment = screen.getByRole("button", { name: "Perfil y reglas" });
    expect(segment).toHaveAttribute("aria-pressed", "true");
    expect(segment).not.toHaveAttribute("aria-expanded");
    expect(screen.getByRole("button", { name: "Modelos" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: "Visión" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: "Teléfono" })).toHaveAttribute("aria-pressed", "false");
  });

  it("localizes the Vision and Phone choices in English and Spanish", () => {
    const view = renderPanel();
    expect(screen.getByRole("button", { name: "Visión" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Teléfono" })).toBeInTheDocument();

    act(() => useUiLocaleStore.getState().setLocale("en"));
    expect(screen.getByRole("button", { name: "Vision" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Phone" })).toBeInTheDocument();
    view.unmount();
  });

  it("defaults to Perfil y reglas — only its pane is visible and all six stay mounted", () => {
    renderPanel();
    expect(screen.getByRole("heading", { name: "Perfil" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Guardarraíles" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Longitud de respuesta" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Datos de la app" })).toBeInTheDocument();

    expect(screen.getByTestId("controles-pane-identity")).not.toHaveAttribute("hidden");
    expect(screen.getByTestId("controles-pane-models")).toHaveAttribute("hidden");
    expect(screen.getByTestId("controles-pane-voice")).toHaveAttribute("hidden");
    expect(screen.getByTestId("controles-pane-models")).toHaveAttribute("hidden");
    expect(screen.getByTestId("controles-pane-vision")).toHaveAttribute("hidden");
    expect(screen.getByTestId("controles-pane-phone")).toHaveAttribute("hidden");
    expect(screen.getByTestId("controles-pane-avatar")).toHaveAttribute("hidden");
    expect(screen.getAllByTestId(/^controles-pane-/)).toHaveLength(6);
    expect(screen.getAllByTestId(/^controles-pane-/).filter((pane) => !pane.hasAttribute("hidden"))).toHaveLength(1);

    // Mounted, not absent — this is the load-bearing difference from a
    // conditional-render pane: a real DOM node backs the hidden headings.
    // `hidden: true` opts into RTL's role query returning them despite being
    // correctly excluded from the accessibility tree — see the plain
    // getByTestId(...) assertions above for the actual "still mounted" proof.
    expect(screen.getByRole("heading", { name: "Modelo", hidden: true })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Voz de Kira", hidden: true })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Avatar", hidden: true })).toBeInTheDocument();
  });

  it("switching to Voz y micrófono keeps voice, pronunciation and PTT together", () => {
    renderPanel();

    fireEvent.click(screen.getByRole("button", { name: "Voz y micrófono" }));

    expect(screen.getByTestId("controles-pane-voice")).not.toHaveAttribute("hidden");
    expect(screen.getByTestId("controles-pane-identity")).toHaveAttribute("hidden");
    expect(screen.getByTestId("controles-pane-models")).toHaveAttribute("hidden");
    expect(screen.getByTestId("controles-pane-vision")).toHaveAttribute("hidden");
    expect(screen.getByTestId("controles-pane-phone")).toHaveAttribute("hidden");
    expect(screen.getByTestId("controles-pane-avatar")).toHaveAttribute("hidden");

    expect(screen.getByRole("heading", { name: "Voz de Kira" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "PTT · Push-to-Talk" })).toBeInTheDocument();
    // Identity is now the hidden pane — still mounted, so its heading is only
    // reachable with `hidden: true` (see the comment in the test above).
    expect(screen.getByRole("heading", { name: "Perfil", hidden: true })).toBeInTheDocument();
  });

  it("switching to Modelos places ModelCard, ProviderCard, and TavilyCard together", () => {
    renderPanel();

    fireEvent.click(screen.getByRole("button", { name: "Modelos" }));

    expect(screen.getByTestId("controles-pane-models")).not.toHaveAttribute("hidden");
    expect(screen.getByTestId("controles-pane-identity")).toHaveAttribute("hidden");
    expect(screen.getByTestId("controles-pane-voice")).toHaveAttribute("hidden");

    expect(screen.getByRole("heading", { name: "Modelo" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Proveedor LLM" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Búsqueda web (Tavily)" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Perfil", hidden: true })).toBeInTheDocument();
  });

  it("switching to Avatar y OBS flips which pane is hidden again", () => {
    renderPanel();

    fireEvent.click(screen.getByRole("button", { name: "Avatar y OBS" }));

    expect(screen.getByTestId("controles-pane-avatar")).not.toHaveAttribute("hidden");
    expect(screen.getByTestId("controles-pane-identity")).toHaveAttribute("hidden");
    expect(screen.getByTestId("controles-pane-models")).toHaveAttribute("hidden");
    expect(screen.getByTestId("controles-pane-voice")).toHaveAttribute("hidden");

    expect(screen.getByRole("heading", { name: "Avatar" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "OBS" })).toBeInTheDocument();
  });

  it("a typed ObsCard Host draft survives a pane round trip (Avatar → Perfil → Avatar) — the regression this change guards", async () => {
    renderPanel();

    fireEvent.click(screen.getByRole("button", { name: "Avatar y OBS" }));
    fireEvent.change(await screen.findByLabelText("Host"), { target: { value: "192.168.1.77" } });
    expect(screen.getByLabelText("Host")).toHaveValue("192.168.1.77");

    fireEvent.click(screen.getByRole("button", { name: "Perfil y reglas" }));
    fireEvent.click(screen.getByRole("button", { name: "Avatar y OBS" }));

    expect(await screen.findByLabelText("Host")).toHaveValue("192.168.1.77");
  });

  it("persists the selected pane across a remount (oc-controles-pane)", () => {
    const { unmount } = renderPanel();

    fireEvent.click(screen.getByRole("button", { name: "Avatar y OBS" }));
    expect(window.localStorage.getItem("oc-controles-pane")).toBe("avatar");

    unmount();
    renderPanel();

    expect(screen.getByRole("heading", { name: "Avatar" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Perfil" })).not.toBeInTheDocument();
  });

  it("places Vision in its own pane, not under Voz y micrófono", async () => {
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "Voz y micrófono" }));
    const voicePane = screen.getByTestId("controles-pane-voice");
    expect(within(voicePane).getByRole("heading", { name: "Voz de Kira" })).toBeInTheDocument();
    expect(within(voicePane).getByRole("heading", { name: "PTT · Push-to-Talk" })).toBeInTheDocument();
    expect(within(voicePane).queryByRole("switch", { name: "Activar visión" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Visión" }));
    const visionPane = screen.getByTestId("controles-pane-vision");
    expect(visionPane).not.toHaveAttribute("hidden");
    expect(await within(visionPane).findByRole("switch", { name: "Activar visión" })).toBeInTheDocument();
    expect(voicePane).toHaveAttribute("hidden");
  });

  it("places phone pairing in its own pane and preserves a minted code across pane switches", async () => {
    const code = "K7Q2-M9XT";
    server.use(
      http.get(`${API_BASE_URL}/api/remote/devices`, () => HttpResponse.json({ devices: [] })),
      http.post(`${API_BASE_URL}/api/remote/pair-code`, () =>
        HttpResponse.json({ code, expires_at: Date.now() / 1000 + 120, gateway_port: 8780 })
      )
    );
    useUiLocaleStore.setState({ locale: "en" });
    renderPanel();

    fireEvent.click(screen.getByRole("button", { name: "Phone" }));
    const phonePane = screen.getByTestId("controles-pane-phone");
    expect(phonePane).not.toHaveAttribute("hidden");
    expect(await within(phonePane).findByRole("heading", { name: "Link phone" })).toBeInTheDocument();
    expect(screen.getByTestId("controles-pane-models")).toHaveAttribute("hidden");
    expect(screen.getByTestId("controles-pane-voice")).toHaveAttribute("hidden");
    expect(screen.getByTestId("controles-pane-models")).toHaveAttribute("hidden");
    expect(screen.getByTestId("controles-pane-vision")).toHaveAttribute("hidden");

    fireEvent.click(await within(phonePane).findByRole("button", { name: "Generate pairing code" }));
    expect(await within(phonePane).findByText(code)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Voice and microphone" }));
    expect(phonePane).toHaveAttribute("hidden");
    fireEvent.click(screen.getByRole("button", { name: "Phone" }));
    expect(within(phonePane).getByText(code)).toBeInTheDocument();
  });

  it.each([
    ["models", "Models"],
    ["vision", "Vision"],
    ["phone", "Phone"]
  ])("persists and restores the new %s pane", (value, label) => {
    useUiLocaleStore.setState({ locale: "en" });
    const first = renderPanel();
    fireEvent.click(screen.getByRole("button", { name: label }));
    expect(window.localStorage.getItem("oc-controles-pane")).toBe(value);
    first.unmount();

    renderPanel();
    expect(screen.getByRole("button", { name: label })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId(`controles-pane-${value}`)).not.toHaveAttribute("hidden");
    expect(screen.getAllByTestId(/^controles-pane-/).filter((pane) => !pane.hasAttribute("hidden"))).toHaveLength(1);
  });

  it.each([
    ["identity", "Perfil y reglas", "identity"],
    ["models", "Modelos", "models"],
    ["voice", "Voz y micrófono", "voice"],
    ["avatar", "Avatar y OBS", "avatar"],
    ["unknown-pane", "Perfil y reglas", "identity"]
  ])("restores legacy or falls back for stored pane %s", (stored, label, pane) => {
    window.localStorage.setItem("oc-controles-pane", stored);
    renderPanel();
    expect(screen.getByRole("button", { name: label })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId(`controles-pane-${pane}`)).not.toHaveAttribute("hidden");
    expect(screen.getAllByTestId(/^controles-pane-/).filter((item) => !item.hasAttribute("hidden"))).toHaveLength(1);
  });

  it("mounts the Decisiones (Laya) card in the identity pane right after Longitud de respuesta", async () => {
    renderPanel();
    const pane = screen.getByTestId("controles-pane-identity");
    const decisions = await within(pane).findByRole("heading", { name: "Decisiones (Laya)" });
    const replyLength = within(pane).getByRole("heading", { name: "Longitud de respuesta" });
    expect(replyLength.compareDocumentPosition(decisions) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
