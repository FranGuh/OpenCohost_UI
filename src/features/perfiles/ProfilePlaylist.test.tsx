import { http, HttpResponse } from "msw";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { beforeEach, describe, expect, it } from "vitest";
import { server } from "../../test/server.js";
import { API_BASE_URL } from "../../test/handlers.js";
import { useSwitchStore } from "../../store/switchStore.js";
import { ProfileSwitchProvider } from "../../api/useProfileSwitch.js";
import { ProfilePlaylist } from "./ProfilePlaylist.js";

// Akira's stored prompt in the default GET /api/perfiles/:name fixture.
const AKIRA_PROMPT = "Sos ingeniosa y filosa, con humor seco.";

function renderList(props: { collapsed?: boolean } = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    React.createElement(
      QueryClientProvider,
      { client: queryClient },
      React.createElement(ProfileSwitchProvider, null, React.createElement(ProfilePlaylist, props))
    )
  );
}

beforeEach(() => {
  useSwitchStore.setState({ pendingSwitch: null });
});

describe("ProfilePlaylist", () => {
  it("lists profiles via useProfileSwitch and highlights the active one", async () => {
    renderList();
    await waitFor(() => expect(screen.getByText("default")).toBeInTheDocument());
    expect(screen.getByText("Akira")).toBeInTheDocument();
    expect(screen.getByText("default")).toHaveClass("text-[var(--kira-cyan)]");
  });

  it("switches profile on row click (shared useProfileSwitch orchestration)", async () => {
    renderList();
    await waitFor(() => expect(screen.getByText("Akira")).toBeInTheDocument());

    fireEvent.click(screen.getByText("Akira"));

    await waitFor(() => expect(screen.getByText("aplicando…")).toBeInTheDocument());
  });
});

describe("ProfilePlaylist — collapsed icon rail", () => {
  it("renders avatar-only rows: name/status text hidden, edit pencil gone, header replaced by an icon-only add button", async () => {
    renderList({ collapsed: true });
    // Row is reachable by its accessible name (aria-label carries it)...
    await waitFor(() => expect(screen.getByRole("button", { name: "Akira" })).toBeInTheDocument());
    // ...but the visible name/status text and the "Perfiles" header are gone.
    expect(screen.queryByText("Akira")).not.toBeInTheDocument();
    expect(screen.queryByText("Perfiles")).not.toBeInTheDocument();
    // The avatar initial still renders.
    expect(screen.getByText("A")).toBeInTheDocument();
    // No per-row edit pencil on the rail.
    expect(screen.queryByRole("button", { name: "Editar perfil Akira" })).not.toBeInTheDocument();
    // "+ Nuevo" collapses to an icon-only button.
    expect(screen.getByRole("button", { name: "Nuevo perfil" })).toBeInTheDocument();
  });

  it("still switches profile on row click when collapsed", async () => {
    renderList({ collapsed: true });
    await waitFor(() => expect(screen.getByRole("button", { name: "Akira" })).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "Akira" }));

    await waitFor(() => expect(useSwitchStore.getState().pendingSwitch?.name).toBe("Akira"));
  });
});

describe("ProfilePlaylist — edit from list", () => {
  it("renders an edit pencil per profile row with a name-specific aria-label", async () => {
    renderList();
    await waitFor(() => expect(screen.getByText("Akira")).toBeInTheDocument());

    expect(screen.getByRole("button", { name: "Editar perfil Akira" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Editar perfil default" })).toBeInTheDocument();
  });

  it("opens the editor prefilled from GET /api/perfiles/:name and does not switch the row", async () => {
    renderList();
    await waitFor(() => expect(screen.getByText("Akira")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "Editar perfil Akira" }));

    // Edit surface, prefilled with the target name and its hydrated prompt.
    expect(screen.getByText("Editar perfil")).toBeInTheDocument();
    expect(screen.getByLabelText("Nombre")).toHaveValue("Akira");
    await waitFor(() => expect(screen.getByLabelText("System prompt")).toHaveValue(AKIRA_PROMPT));

    // The pencil must not have triggered the row's activate-on-click.
    expect(screen.queryByText("aplicando…")).not.toBeInTheDocument();
  });

  it("saving an edit PUTs to /api/perfiles/:name and refreshes the profile list", async () => {
    let listCalls = 0;
    let putBody: unknown;
    server.use(
      http.get(`${API_BASE_URL}/api/perfiles`, () => {
        listCalls += 1;
        return HttpResponse.json({ profiles: ["default", "Akira"] });
      }),
      http.put(`${API_BASE_URL}/api/perfiles/Akira`, async ({ request }) => {
        putBody = await request.json();
        return HttpResponse.json({ name: "Akira 2", id: "profile-id-akira", prompt: AKIRA_PROMPT, use_system: false });
      })
    );
    renderList();
    await waitFor(() => expect(screen.getByText("Akira")).toBeInTheDocument());
    const callsAfterLoad = listCalls;

    fireEvent.click(screen.getByRole("button", { name: "Editar perfil Akira" }));
    // Wait for hydration so Guardar resends the real prompt, not an empty one.
    await waitFor(() => expect(screen.getByLabelText("System prompt")).toHaveValue(AKIRA_PROMPT));
    fireEvent.change(screen.getByLabelText("Nombre"), { target: { value: "Akira 2" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(putBody).toEqual({ new_name: "Akira 2", prompt: AKIRA_PROMPT });
    // A successful PUT invalidates PROFILES_QUERY_KEY → the list refetches.
    await waitFor(() => expect(listCalls).toBeGreaterThan(callsAfterLoad));
  });
});
