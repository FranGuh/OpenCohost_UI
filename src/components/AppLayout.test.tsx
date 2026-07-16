import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { beforeEach, describe, expect, it } from "vitest";
import { useSwitchStore } from "../store/switchStore.js";
import { useWelcomeStore } from "../store/welcomeStore.js";
import { AppLayout } from "./AppLayout.js";
import { TitleBar } from "./TitleBar.js";
import { ToastProvider } from "./ui/Toast.js";

beforeEach(() => {
  useSwitchStore.setState({ pendingSwitch: null });
  window.localStorage.clear();
  useWelcomeStore.setState({ dismissed: false });
});

function renderApp() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  // The status/gear cluster now portals from AppLayout into the merged TitleBar's
  // slot, so render the bar alongside — it provides the slot and the banner the
  // header assertions cover, exactly like the real App shell.
  return render(
    React.createElement(
      QueryClientProvider,
      { client: queryClient },
      React.createElement(
        ToastProvider,
        null,
        React.createElement(React.Fragment, null, React.createElement(TitleBar), React.createElement(AppLayout))
      )
    )
  );
}

describe("AppLayout", () => {
  it("renders exactly one of each landmark and Experiencia content by default", () => {
    renderApp();
    expect(screen.getByRole("banner")).toBeInTheDocument();
    expect(screen.getByRole("navigation")).toBeInTheDocument();
    expect(screen.getByRole("main")).toBeInTheDocument();
    expect(screen.getByRole("complementary")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Kira" })).toBeInTheDocument();
  });

  it("restores Welcome from Settings and returns section ownership to Experiencia", () => {
    useWelcomeStore.setState({ dismissed: true });
    renderApp();
    fireEvent.click(screen.getByRole("button", { name: /Controles/ }));
    fireEvent.click(screen.getByRole("button", { name: "Configuración" }));

    fireEvent.click(screen.getByRole("button", { name: "Volver a ver bienvenida" }));

    expect(screen.getByRole("button", { name: /Experiencia/ })).toHaveAttribute("aria-current", "true");
    expect(screen.getByRole("dialog", { name: "Conocé a Kira" })).toBeInTheDocument();
    expect(screen.getByText("1 de 5")).toBeInTheDocument();
    expect(useWelcomeStore.getState().dismissed).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: "Cerrar bienvenida" }));
    expect(screen.getByRole("button", { name: "Configuración" })).toHaveFocus();
  });

  it("hydrates the sidebar collapsed state from localStorage (oc-sidebar-collapsed)", () => {
    window.localStorage.setItem("oc-sidebar-collapsed", "1");
    renderApp();

    // Collapsed: the toggle offers to expand, and nav labels are icon-only
    // (accessible name kept via aria-label, visible text gone).
    expect(screen.getByRole("button", { name: "Expandir barra lateral" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Experiencia" })).toBeInTheDocument();
    expect(screen.queryByText("Experiencia")).not.toBeInTheDocument();
  });

  it("toggling the sidebar collapse persists the choice to localStorage", () => {
    renderApp();
    // Default expanded (localStorage cleared in beforeEach).
    expect(screen.queryByText("Experiencia")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Colapsar barra lateral" }));
    expect(window.localStorage.getItem("oc-sidebar-collapsed")).toBe("1");
    expect(screen.queryByText("Experiencia")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Expandir barra lateral" }));
    expect(window.localStorage.getItem("oc-sidebar-collapsed")).toBe("0");
    expect(screen.queryByText("Experiencia")).toBeInTheDocument();
  });

  it("switches to Controles on nav click and marks aria-current", () => {
    renderApp();
    const controlesBtn = screen.getByRole("button", { name: /Controles/ });
    const experienciaBtn = screen.getByRole("button", { name: /Experiencia/ });
    expect(experienciaBtn).toHaveAttribute("aria-current", "true");

    fireEvent.click(controlesBtn);

    expect(controlesBtn).toHaveAttribute("aria-current", "true");
    expect(experienciaBtn).not.toHaveAttribute("aria-current");
    expect(screen.queryByRole("heading", { name: "Kira" })).not.toBeInTheDocument();
    expect(screen.getByText("Perfil")).toBeInTheDocument();
  });

  it("switches to Agenda on nav click, marks aria-current, and renders AgendaPanel", () => {
    renderApp();
    const agendaBtn = screen.getByRole("button", { name: /Agenda/ });
    expect(agendaBtn).not.toHaveAttribute("aria-current");

    fireEvent.click(agendaBtn);

    expect(agendaBtn).toHaveAttribute("aria-current", "true");
    expect(screen.queryByRole("heading", { name: "Kira" })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Perfil Co-host" })).toBeInTheDocument();
  });

  it("switches to Stream on nav click, marks aria-current, and renders StreamPanel", () => {
    renderApp();
    const streamBtn = screen.getByRole("button", { name: /Stream/ });
    expect(streamBtn).not.toHaveAttribute("aria-current");

    fireEvent.click(streamBtn);

    expect(streamBtn).toHaveAttribute("aria-current", "true");
    expect(screen.queryByRole("heading", { name: "Kira" })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Chat en vivo" })).toBeInTheDocument();
  });

  it("switches to Música on nav click, marks aria-current, and renders MusicPanel", () => {
    renderApp();
    const musicaBtn = screen.getByRole("button", { name: /Música/ });
    expect(musicaBtn).not.toHaveAttribute("aria-current");

    fireEvent.click(musicaBtn);

    expect(musicaBtn).toHaveAttribute("aria-current", "true");
    expect(screen.queryByRole("heading", { name: "Kira" })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Mood" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Biblioteca" })).toBeInTheDocument();
  });

  it("shares one ProfileSwitchProvider owner across ProfilePlaylist and ProfileSwitcher (no double-poll)", async () => {
    renderApp();

    // Controles mounts ProfileSwitcher alongside Sidebar's always-on
    // ProfilePlaylist, so both consumers of the lifted context are live.
    fireEvent.click(screen.getByRole("button", { name: /Controles/ }));
    const select = (await screen.findByLabelText("Perfil activo")) as HTMLSelectElement;
    await waitFor(() => expect(select.value).toBe("default"));

    // Driving the switch from the OTHER consumer (ProfilePlaylist's row)...
    // Anchor the name so it matches the row button ("Akira perfil") only, not
    // its edit pencil ("Editar perfil Akira").
    fireEvent.click(screen.getByRole("button", { name: /^Akira/ }));

    // ...must be reflected by ProfileSwitcher reading the SAME shared
    // pending state — proof there is exactly one poll owner, not two.
    await waitFor(() => expect(select).toBeDisabled());
  });
});
