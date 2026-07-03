import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { beforeEach, describe, expect, it } from "vitest";
import { useSwitchStore } from "../store/switchStore.js";
import { AppLayout } from "./AppLayout.js";

beforeEach(() => {
  useSwitchStore.setState({ pendingSwitch: null });
});

function renderApp() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    React.createElement(QueryClientProvider, { client: queryClient }, React.createElement(AppLayout))
  );
}

describe("AppLayout", () => {
  it("renders exactly one of each landmark and Experiencia content by default", () => {
    renderApp();
    expect(screen.getByRole("banner")).toBeInTheDocument();
    expect(screen.getByRole("navigation")).toBeInTheDocument();
    expect(screen.getByRole("main")).toBeInTheDocument();
    expect(screen.getByRole("complementary")).toBeInTheDocument();
    expect(screen.getByRole("contentinfo")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Kira" })).toBeInTheDocument();
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

  it("does not switch when an inert nav item is clicked", () => {
    renderApp();
    fireEvent.click(screen.getByRole("button", { name: /Inicio/ }));
    expect(screen.getByRole("heading", { name: "Kira" })).toBeInTheDocument();
  });

  it("shares one ProfileSwitchProvider owner across ProfilePlaylist and ProfileSwitcher (no double-poll)", async () => {
    renderApp();

    // Controles mounts ProfileSwitcher alongside Sidebar's always-on
    // ProfilePlaylist, so both consumers of the lifted context are live.
    fireEvent.click(screen.getByRole("button", { name: /Controles/ }));
    const select = (await screen.findByLabelText("Perfil activo")) as HTMLSelectElement;
    await waitFor(() => expect(select.value).toBe("default"));

    // Driving the switch from the OTHER consumer (ProfilePlaylist's row)...
    fireEvent.click(screen.getByRole("button", { name: /Akira/ }));

    // ...must be reflected by ProfileSwitcher reading the SAME shared
    // pending state — proof there is exactly one poll owner, not two.
    await waitFor(() => expect(select).toBeDisabled());
  });
});
