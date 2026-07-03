import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { beforeEach, describe, expect, it } from "vitest";
import { useSwitchStore } from "../store/switchStore.js";
import { ProfileSwitchProvider } from "../api/useProfileSwitch.js";
import { ProfilePlaylist } from "./ProfilePlaylist.js";

function renderList() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    React.createElement(
      QueryClientProvider,
      { client: queryClient },
      React.createElement(ProfileSwitchProvider, null, React.createElement(ProfilePlaylist))
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
