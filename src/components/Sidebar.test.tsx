import { http, HttpResponse } from "msw";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { server } from "../test/server.js";
import { API_BASE_URL, defaultProfileDetails } from "../test/handlers.js";
import { useSwitchStore } from "../store/switchStore.js";
import { ProfileSwitchProvider } from "../api/useProfileSwitch.js";
import { Sidebar } from "./Sidebar.js";

// Matches HOVER_INTENT_MS / CLOSE_FADE_MS in Sidebar.tsx.
const HOVER_INTENT_MS = 700;
const CLOSE_FADE_MS = 220;
// Akira's stored prompt in the default GET /api/perfiles/:name fixture.
const AKIRA_PROMPT = defaultProfileDetails.Akira.prompt;

function renderSidebar(overrides: { collapsed?: boolean; onSelect?: (s: string) => void; onToggleCollapse?: () => void } = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    React.createElement(
      QueryClientProvider,
      { client: queryClient },
      React.createElement(
        ProfileSwitchProvider,
        null,
        React.createElement(Sidebar, {
          activeSection: "experiencia",
          onSelect: overrides.onSelect ?? (() => {}),
          collapsed: overrides.collapsed ?? false,
          onToggleCollapse: overrides.onToggleCollapse ?? (() => {})
        })
      )
    )
  );
}

beforeEach(() => {
  useSwitchStore.setState({ pendingSwitch: null });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("Sidebar — collapsible icon rail", () => {
  it("renders a collapse toggle that calls onToggleCollapse when expanded", () => {
    const onToggleCollapse = vi.fn();
    renderSidebar({ onToggleCollapse });

    const toggle = screen.getByRole("button", { name: "Colapsar barra lateral" });
    fireEvent.click(toggle);

    expect(onToggleCollapse).toHaveBeenCalledTimes(1);
  });

  it("collapsed: nav shows icons only (labels hidden) but keeps accessible names, and the toggle flips to Expandir", () => {
    renderSidebar({ collapsed: true });

    // Accessible name survives via aria-label...
    expect(screen.getByRole("button", { name: "Experiencia" })).toBeInTheDocument();
    // ...but the visible label text is gone.
    expect(screen.queryByText("Experiencia")).not.toBeInTheDocument();
    // Toggle now offers to expand.
    expect(screen.getByRole("button", { name: "Expandir barra lateral" })).toBeInTheDocument();
  });

  it("collapsed: nav still navigates on click", () => {
    const onSelect = vi.fn();
    renderSidebar({ collapsed: true, onSelect });

    fireEvent.click(screen.getByRole("button", { name: "Agenda" }));

    expect(onSelect).toHaveBeenCalledWith("agenda");
  });
});

describe("Sidebar — profile hover-intent preview card", () => {
  it("shows the preview card only after a 700ms hover dwell (HOVER_INTENT_MS), naming the profile as info", async () => {
    renderSidebar();
    // Load the real profile rows under real timers before controlling the dwell.
    const row = await screen.findByText("Akira");

    vi.useFakeTimers();
    fireEvent.pointerOver(row);
    // Nothing yet — the dwell hasn't elapsed.
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(HOVER_INTENT_MS);
    });

    const tip = screen.getByRole("tooltip");
    expect(tip).toHaveTextContent("Akira");
    // The card is now framed as informational, stating where profiles are edited.
    expect(tip).toHaveTextContent("Info del perfil — se edita desde Controles");
  });

  it("shows the card immediately on keyboard focus (no dwell) and wires aria-describedby row → card", async () => {
    renderSidebar();
    const rowButton = (await screen.findByText("Akira")).closest("button") as HTMLButtonElement;

    fireEvent.focus(rowButton);

    const tip = screen.getByRole("tooltip");
    expect(tip).toHaveTextContent("Akira");
    expect(rowButton).toHaveAttribute("aria-describedby", tip.id);
  });

  it("hides the card on Escape (after the exit fade elapses)", async () => {
    renderSidebar();
    const rowButton = (await screen.findByText("Akira")).closest("button") as HTMLButtonElement;

    fireEvent.focus(rowButton);
    expect(screen.getByRole("tooltip")).toBeInTheDocument();

    vi.useFakeTimers();
    fireEvent.keyDown(document.body, { key: "Escape" });
    act(() => {
      vi.advanceTimersByTime(CLOSE_FADE_MS);
    });
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });
});

describe("Sidebar — profile hover card v2 (owner adjust round 3)", () => {
  it("renders the profile's real stored prompt once the detail fetch resolves", async () => {
    renderSidebar();
    const rowButton = (await screen.findByText("Akira")).closest("button") as HTMLButtonElement;

    fireEvent.focus(rowButton); // immediate show enables the per-profile detail query
    expect(await screen.findByText(AKIRA_PROMPT)).toBeInTheDocument();
  });

  it("fetches a profile's prompt once and serves every later hover from cache (no refetch)", async () => {
    let calls = 0;
    server.use(
      http.get(`${API_BASE_URL}/api/perfiles/:name`, ({ params }) => {
        calls += 1;
        const name = decodeURIComponent(String(params.name));
        const detail = defaultProfileDetails[name];
        return detail ? HttpResponse.json(detail) : HttpResponse.json({ detail: "profile not found" }, { status: 404 });
      })
    );
    renderSidebar();
    const rowButton = (await screen.findByText("Akira")).closest("button") as HTMLButtonElement;

    // First open fetches exactly once.
    fireEvent.focus(rowButton);
    await screen.findByText(AKIRA_PROMPT);
    expect(calls).toBe(1);

    // Close, then reopen the SAME profile — cache-only, no second request
    // (staleTime: Infinity keyed per profile name).
    fireEvent.blur(rowButton);
    await waitFor(() => expect(screen.queryByRole("tooltip")).not.toBeInTheDocument());

    fireEvent.focus(rowButton);
    await screen.findByText(AKIRA_PROMPT);
    expect(calls).toBe(1);
  });

  it("keeps the card mounted through the exit fade, then unmounts it (fade out before unmount)", async () => {
    renderSidebar();
    const rowButton = (await screen.findByText("Akira")).closest("button") as HTMLButtonElement;

    fireEvent.focus(rowButton);
    expect(screen.getByRole("tooltip")).toBeInTheDocument();

    vi.useFakeTimers();
    fireEvent.blur(rowButton);
    // Still mounted immediately after blur — fading out, not gone.
    const fading = screen.getByRole("tooltip");
    expect(fading).toBeInTheDocument();
    expect(fading).toHaveClass("opacity-0");

    act(() => {
      vi.advanceTimersByTime(CLOSE_FADE_MS);
    });
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });
});
