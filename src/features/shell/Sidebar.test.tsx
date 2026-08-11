import { http, HttpResponse } from "msw";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { server } from "../../test/server.js";
import { API_BASE_URL, defaultProfileDetails } from "../../test/handlers.js";
import { useSwitchStore } from "../../store/switchStore.js";
import { ProfileSwitchProvider } from "../../api/useProfileSwitch.js";
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

// Owner request: once collapsed, the label is gone from the button, so hovering
// an icon should float the section name beside it — reusing the PERFILES card
// treatment, and staying inside the viewport.
describe("Sidebar — collapsed nav name-on-hover", () => {
  /** The floating card, if mounted. It is aria-hidden (the name is already the
   * button's aria-label), so it is reachable by text but never by role. */
  const nameCard = (label: string) =>
    screen.queryAllByText(label).find((el) => el.getAttribute("aria-hidden") === "true") ?? null;

  it("shows the section name only after the 700ms dwell, and only while collapsed", () => {
    vi.useFakeTimers();
    renderSidebar({ collapsed: true });

    fireEvent.pointerEnter(screen.getByRole("button", { name: "Agenda" }));
    // Mid-dwell: nothing yet — this is hover INTENT, not hover.
    act(() => void vi.advanceTimersByTime(HOVER_INTENT_MS - 1));
    expect(nameCard("Agenda")).toBeNull();

    act(() => void vi.advanceTimersByTime(1));
    expect(nameCard("Agenda")).not.toBeNull();
  });

  it("shows nothing on hover when the rail is expanded — the label is already on the button", () => {
    vi.useFakeTimers();
    renderSidebar({ collapsed: false });

    fireEvent.pointerEnter(screen.getByRole("button", { name: "Agenda" }));
    act(() => void vi.advanceTimersByTime(HOVER_INTENT_MS));

    // Only the button's own visible label — no floating duplicate beside it.
    expect(nameCard("Agenda")).toBeNull();
    expect(screen.getByRole("button", { name: "Agenda" })).toHaveTextContent("Agenda");
  });

  it("opens immediately on keyboard focus (no dwell) and fades out on blur", () => {
    vi.useFakeTimers();
    renderSidebar({ collapsed: true });

    const btn = screen.getByRole("button", { name: "Memoria" });
    fireEvent.focus(btn);
    expect(nameCard("Memoria")).not.toBeNull();

    fireEvent.blur(btn);
    // Still mounted through the exit fade, then gone — the card must not
    // vanish mid-transition.
    expect(nameCard("Memoria")).not.toBeNull();
    act(() => void vi.advanceTimersByTime(CLOSE_FADE_MS));
    expect(nameCard("Memoria")).toBeNull();
  });

  it("clamps the card inside the viewport instead of letting a low nav item push it off the bottom", () => {
    vi.useFakeTimers();
    renderSidebar({ collapsed: true });
    const btn = screen.getByRole("button", { name: "Controles" }); // last nav item

    // jsdom reports offsetHeight 0, so stub the measured card height and put
    // the button low in a short viewport. Clamp: min(btnTop, innerHeight - h - 8).
    const originalOffset = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetHeight");
    const originalInnerHeight = window.innerHeight;
    try {
      Object.defineProperty(window, "innerHeight", { configurable: true, value: 400 });
      Object.defineProperty(HTMLElement.prototype, "offsetHeight", { configurable: true, get: () => 40 });
      btn.getBoundingClientRect = () =>
        ({ top: 380, right: 60, bottom: 416, left: 0, width: 60, height: 36, x: 0, y: 380, toJSON: () => ({}) }) as DOMRect;

      fireEvent.focus(btn);
      const card = nameCard("Controles");
      expect(card).not.toBeNull();
      // 380 would run off a 400px-tall window; 400 - 40 - 8 = 352 does not.
      expect(card).toHaveStyle({ position: "fixed", left: "68px", top: "352px" });
    } finally {
      if (originalOffset) Object.defineProperty(HTMLElement.prototype, "offsetHeight", originalOffset);
      Object.defineProperty(window, "innerHeight", { configurable: true, value: originalInnerHeight });
    }
  });
});

describe("Sidebar — scroll scoping + footer toggle", () => {
  it("scopes scrolling to the profiles region — the nav rail itself does not scroll", () => {
    renderSidebar();
    const nav = screen.getByRole("navigation");
    // The whole rail no longer scrolls as one block...
    expect(nav).toHaveClass("overflow-hidden");
    expect(nav).not.toHaveClass("overflow-auto");
    // ...only the profiles region does (flex-1 min-h-0 overflow-y-auto).
    const region = screen.getByText("Perfiles").closest("div.overflow-y-auto");
    expect(region).not.toBeNull();
    expect(region).toHaveClass("flex-1", "min-h-0", "overflow-y-auto");
    // The fixed nav items live OUTSIDE that scroll region.
    const experiencia = screen.getByRole("button", { name: "Experiencia" });
    expect(region?.contains(experiencia)).toBe(false);
  });

  it("places the collapse toggle in a slim bordered footer row at the bottom of the rail", () => {
    renderSidebar();
    const toggle = screen.getByRole("button", { name: "Colapsar barra lateral" });
    const footer = toggle.parentElement as HTMLElement;
    expect(footer).toHaveClass("border-t");
    // Footer is the rail's last child — below the profiles scroll region.
    expect(screen.getByRole("navigation").lastElementChild).toBe(footer);
    // Expanded: the toggle shows its "Colapsar" label.
    expect(toggle).toHaveTextContent("Colapsar");
  });

  it("collapses the footer toggle to icon-only (label hidden, aria-label kept) when collapsed", () => {
    renderSidebar({ collapsed: true });
    const toggle = screen.getByRole("button", { name: "Expandir barra lateral" });
    // Accessible name survives via aria-label; the visible "Colapsar" text is gone.
    expect(toggle).not.toHaveTextContent("Colapsar");
    expect(screen.getByRole("navigation").lastElementChild).toBe(toggle.parentElement);
  });

  it("hides an open preview card when the profiles region scrolls (no stale fixed card)", async () => {
    renderSidebar();
    const rowButton = (await screen.findByText("Akira")).closest("button") as HTMLButtonElement;

    fireEvent.focus(rowButton); // immediate show
    expect(screen.getByRole("tooltip")).toBeInTheDocument();

    const region = screen.getByText("Perfiles").closest("div.overflow-y-auto") as HTMLElement;
    vi.useFakeTimers();
    fireEvent.scroll(region);
    act(() => {
      vi.advanceTimersByTime(CLOSE_FADE_MS);
    });
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
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

describe("Sidebar — profile hover card v3 (detail round: viewport clamp)", () => {
  it("clamps the fixed card's top so a bottom-edge row never overflows the viewport", async () => {
    renderSidebar();
    const rowButton = (await screen.findByText("Akira")).closest("button") as HTMLButtonElement;
    const li = rowButton.closest("li") as HTMLLIElement;

    // jsdom reports offsetHeight 0, so stub the measured card height; put the row
    // low in a short viewport. Clamp math: min(rowTop, innerHeight - height - 8).
    const originalOffset = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetHeight");
    const originalInnerHeight = window.innerHeight;
    try {
      Object.defineProperty(window, "innerHeight", { configurable: true, value: 600 });
      Object.defineProperty(HTMLElement.prototype, "offsetHeight", { configurable: true, get: () => 220 });
      li.getBoundingClientRect = () =>
        ({ top: 560, right: 48, bottom: 590, left: 8, width: 40, height: 30, x: 8, y: 560, toJSON() {} }) as DOMRect;

      fireEvent.focus(rowButton); // immediate show → useLayoutEffect measures + clamps

      // Row's own top is 560, but 600 - 220 - 8 = 372 is higher, so it clamps to 372.
      expect(screen.getByRole("tooltip")).toHaveStyle({ top: "372px" });
    } finally {
      if (originalOffset) Object.defineProperty(HTMLElement.prototype, "offsetHeight", originalOffset);
      Object.defineProperty(window, "innerHeight", { configurable: true, value: originalInnerHeight });
    }
  });
});
