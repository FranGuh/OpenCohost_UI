import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ChatStatsChip } from "./ChatStatsChip.js";
import { useChatStatsStore } from "../../store/chatStatsStore.js";

function renderWithClient(ui: React.ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

describe("ChatStatsChip component", () => {
  beforeEach(() => {
    window.localStorage.clear();
    useChatStatsStore.getState().resetAll();
  });

  it("renders the compact chip with default zero/tag label", () => {
    renderWithClient(
      <ChatStatsChip
        activeProfileId="p-1"
        activeProfileName="Kira Default"
        activeModelName="qwen2.5:7b"
      />
    );

    const button = screen.getByRole("button", { name: "Estadísticas e impacto" });
    expect(button).toBeInTheDocument();
    expect(button).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByText("Estadísticas")).toBeInTheDocument();
  });

  it("reflects profile turns and searches count in the trigger button", () => {
    useChatStatsStore.getState().recordTurn("p-1", "qwen2.5:7b", 120);
    useChatStatsStore.getState().recordTurn("p-1", "qwen2.5:7b", 150);
    useChatStatsStore.getState().recordSearch();

    renderWithClient(
      <ChatStatsChip
        activeProfileId="p-1"
        activeProfileName="Kira Default"
        activeModelName="qwen2.5:7b"
      />
    );

    expect(screen.getByText("2t")).toBeInTheDocument();
    expect(screen.getByText("· 1s")).toBeInTheDocument();
  });

  it("opens the popover dialog when clicked and exposes all metric cards and sponsor CTAs", async () => {
    const user = userEvent.setup();
    useChatStatsStore.getState().recordTurn("p-1", "qwen2.5:7b", 350);
    useChatStatsStore.getState().recordSearch();
    useChatStatsStore.getState().recordSearch();

    renderWithClient(
      <ChatStatsChip
        activeProfileId="p-1"
        activeProfileName="Kira Streamer"
        activeModelName="qwen2.5:7b"
      />
    );

    const trigger = screen.getByRole("button", { name: "Estadísticas e impacto" });
    await user.click(trigger);

    expect(trigger).toHaveAttribute("aria-expanded", "true");
    const dialog = screen.getByRole("dialog", { name: "Tu impacto con OpenCohost" });
    expect(dialog).toBeInTheDocument();

    // Check metric labels and values
    expect(screen.getByText("Búsquedas web")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument(); // searchesCount

    expect(screen.getByText("Memorias generadas")).toBeInTheDocument();
    expect(screen.getByText("Interacciones")).toBeInTheDocument();
    expect(screen.getByText("1")).toBeInTheDocument(); // profile turns

    expect(screen.getByText("Inferencia promedio")).toBeInTheDocument();
    expect(screen.getByText("350ms")).toBeInTheDocument(); // avg latency

    expect(screen.getByText("Modelo preferido")).toBeInTheDocument();
    expect(screen.getByText("qwen2.5:7b")).toBeInTheDocument();

    expect(screen.getByText("Tiempo en sesión")).toBeInTheDocument();

    // Check sponsor section & outbound links (NO emojis)
    expect(screen.getByText("Desarrollo Independiente")).toBeInTheDocument();
    const starLink = screen.getByRole("link", { name: /Dar Star en GitHub/i });
    expect(starLink).toHaveAttribute("href", "https://github.com/plynte-labs/OpenCohost");
    expect(starLink).toHaveAttribute("target", "_blank");
    expect(starLink).toHaveAttribute("rel", "noopener noreferrer");

    const sponsorLink = screen.getByRole("link", { name: /Patrocinar a FranGuh/i });
    expect(sponsorLink).toHaveAttribute("href", "https://github.com/sponsors/franguh");
    expect(sponsorLink).toHaveAttribute("target", "_blank");
    expect(sponsorLink).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("closes the popover when clicking the close button", async () => {
    const user = userEvent.setup();
    renderWithClient(<ChatStatsChip activeProfileId="p-1" />);

    const trigger = screen.getByRole("button", { name: "Estadísticas e impacto" });
    await user.click(trigger);
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    const closeBtn = screen.getByRole("button", { name: "Cerrar estadísticas" });
    await user.click(closeBtn);

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(trigger).toHaveAttribute("aria-expanded", "false");
  });

  it("closes the popover when pressing Escape", async () => {
    const user = userEvent.setup();
    renderWithClient(<ChatStatsChip activeProfileId="p-1" />);

    await user.click(screen.getByRole("button", { name: "Estadísticas e impacto" }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("closes the popover on click outside", async () => {
    const user = userEvent.setup();
    renderWithClient(
      <div>
        <div data-testid="outside-area">Outside</div>
        <ChatStatsChip activeProfileId="p-1" />
      </div>
    );

    await user.click(screen.getByRole("button", { name: "Estadísticas e impacto" }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    fireEvent.mouseDown(screen.getByTestId("outside-area"));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("does not count session time while the model is inactive", () => {
    useChatStatsStore.getState().updateModelActiveState(false);
    expect(useChatStatsStore.getState().getSessionDurationSeconds()).toBe(0);

    renderWithClient(
      <ChatStatsChip
        activeProfileId="p-1"
        isModelActive={false}
      />
    );

    expect(useChatStatsStore.getState().getSessionDurationSeconds()).toBe(0);
  });

  it("accumulates session time only during active segments", () => {
    const store = useChatStatsStore.getState();
    const baseNow = 1000000;
    vi.spyOn(Date, "now").mockReturnValue(baseNow);

    // Start active model
    store.updateModelActiveState(true);

    // 60 seconds pass with active model
    vi.spyOn(Date, "now").mockReturnValue(baseNow + 60000);
    expect(store.getSessionDurationSeconds()).toBe(60);

    // Deactivate model
    store.updateModelActiveState(false);
    expect(store.getSessionDurationSeconds()).toBe(60);

    // 10 hours pass while inactive
    vi.spyOn(Date, "now").mockReturnValue(baseNow + 60000 + 36000000);
    // Time should remain exactly 60 seconds!
    expect(store.getSessionDurationSeconds()).toBe(60);

    // Re-activate model for another 30 seconds
    const reactivateTime = baseNow + 60000 + 36000000;
    store.updateModelActiveState(true);
    vi.spyOn(Date, "now").mockReturnValue(reactivateTime + 30000);
    expect(store.getSessionDurationSeconds()).toBe(90);

    vi.restoreAllMocks();
  });
});

describe("ChatStatsChip activity entry", () => {
  beforeEach(() => {
    window.localStorage.clear();
    useChatStatsStore.getState().resetAll();
  });

  it("opens the Activity panel from the popover", async () => {
    renderWithClient(<ChatStatsChip activeProfileId="p-1" activeModelName="qwen2.5:7b" />);
    await userEvent.click(screen.getByRole("button", { name: "Estadísticas e impacto" }));
    await userEvent.click(screen.getByRole("button", { name: "Actividad" }));
    expect(await screen.findByRole("dialog", { name: "Actividad" })).toBeInTheDocument();
  });
});
