import { act, fireEvent, render as rtlRender, screen, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { server } from "../../test/server.js";
import { API_BASE_URL } from "../../test/handlers.js";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { DesktopCompanion } from "./DesktopCompanion.js";
import { useVisionPhaseStore } from "../../store/visionStore.js";

// The companion reads GET /api/vision (look control), so it needs a query client.
function render(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return rtlRender(ui, { wrapper: ({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider> });
}

const mockGetDesktopState = vi.fn();
const mockOnDesktopState = vi.fn();
const mockDesktopReady = vi.fn();
const mockReconcileDesktop = vi.fn();

vi.mock("./desktopClient.js", () => ({
  getDesktopState: () => mockGetDesktopState(),
  onDesktopState: (cb: any) => mockOnDesktopState(cb),
  desktopReady: (gen: number) => mockDesktopReady(gen),
  reconcileDesktop: () => mockReconcileDesktop(),
}));

const mockBootstrapBackend = vi.fn();
vi.mock("../../lib/backendBootstrap.js", () => ({
  bootstrapBackend: () => mockBootstrapBackend(),
}));

vi.mock("../avatar-vrm/components/VrmStage.js", () => ({
  VrmStage: ({ url, active, looking }: { url: string; active?: boolean; looking?: boolean }) => (
    <div data-testid="vrm-stage" data-url={url} data-active={String(active)} data-looking={String(Boolean(looking))} />
  ),
}));

const mockUseServerEventLog = vi.fn();
vi.mock("../../api/events.js", () => ({
  useServerEventLog: () => mockUseServerEventLog(),
}));

vi.mock("../../api/status.js", () => ({
  useStatusQuery: () => ({ data: { avatar_state: "idle" } }),
}));

const mockPttStart = vi.fn();
const mockPttStop = vi.fn();

vi.mock("../../api/ptt.js", () => ({
  usePttHold: () => ({
    state: "idle",
    error: null,
    start: mockPttStart,
    stop: mockPttStop,
  }),
}));

const mockStartDragging = vi.fn().mockResolvedValue(undefined);
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    startDragging: mockStartDragging,
  }),
}));

const mockSendChatTurn = vi.fn();
let mockIsSending = false;

vi.mock("../../api/chat.js", () => ({
  useSendChatTurn: () => ({
    send: (text: string) => mockSendChatTurn(text),
    get pending() {
      return mockIsSending;
    },
    isError: false,
    error: null,
    reset: vi.fn(),
  }),
}));

describe("DesktopCompanion public surface", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useVisionPhaseStore.setState({ phase: "idle" });
    mockGetDesktopState.mockResolvedValue({
      enabled: true,
      visible: true,
      ready: false,
      model: "avatar.vrm",
      revision: 1,
      generation: 1,
      error: null,
    });
    mockOnDesktopState.mockResolvedValue(() => {});
    mockDesktopReady.mockResolvedValue({});
    mockReconcileDesktop.mockResolvedValue({});
    mockBootstrapBackend.mockResolvedValue({ backendError: null });
  });

  it("subscribes to the server event log itself and plays the look pose for the whole look", async () => {
    render(<DesktopCompanion />);
    expect(mockUseServerEventLog).toHaveBeenCalled();
    const stage = await screen.findByTestId("vrm-stage");
    expect(stage).toHaveAttribute("data-looking", "false");
    for (const [phase, looking] of [["looking", "true"], ["describing", "true"], ["done", "false"]] as const) {
      act(() => useVisionPhaseStore.getState().setPhase(phase));
      expect(stage).toHaveAttribute("data-looking", looking);
    }
  });

  it("initial mount has controls concealed (no textbox or hold-to-talk button)", async () => {
    render(<DesktopCompanion />);
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /hablar|talk/i })).not.toBeInTheDocument();
  });

  it("clicking the avatar toggles the controls strip open and closed", async () => {
    const { container } = render(<DesktopCompanion />);
    const avatar = container.querySelector(".desktop-avatar");
    expect(avatar).toBeInTheDocument();

    // Click on avatar
    fireEvent.pointerDown(avatar!, { button: 0, clientX: 10, clientY: 10 });
    fireEvent.pointerUp(avatar!, { button: 0, clientX: 10, clientY: 10 });

    expect(screen.getByRole("textbox")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /hablar|talk/i })).toBeInTheDocument();

    // Second click on avatar conceals controls
    fireEvent.pointerDown(avatar!, { button: 0, clientX: 10, clientY: 10 });
    fireEvent.pointerUp(avatar!, { button: 0, clientX: 10, clientY: 10 });

    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("notifies desktopReady after model is available", async () => {
    render(<DesktopCompanion />);
    await waitFor(() => {
      expect(mockDesktopReady).toHaveBeenCalledWith(1);
    });
  });

  it("pressing Escape conceals controls", async () => {
    const { container } = render(<DesktopCompanion />);
    const avatar = container.querySelector(".desktop-avatar");

    // Click to open
    fireEvent.pointerDown(avatar!, { button: 0, clientX: 10, clientY: 10 });
    fireEvent.pointerUp(avatar!, { button: 0, clientX: 10, clientY: 10 });
    expect(screen.getByRole("textbox")).toBeInTheDocument();

    // Escape key
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Escape" });
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("surfaces bootstrap error in controls if bootstrap fails", async () => {
    mockBootstrapBackend.mockResolvedValueOnce({ backendError: "ipc_unavailable" });
    const { container } = render(<DesktopCompanion />);
    const avatar = container.querySelector(".desktop-avatar");

    // Click to open
    fireEvent.pointerDown(avatar!, { button: 0, clientX: 10, clientY: 10 });
    fireEvent.pointerUp(avatar!, { button: 0, clientX: 10, clientY: 10 });

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent("ipc_unavailable");
    });
  });

  it("mic button pointerdown starts PTT and pointerup stops PTT", async () => {
    const { container } = render(<DesktopCompanion />);
    const avatar = container.querySelector(".desktop-avatar");

    // Click to open
    fireEvent.pointerDown(avatar!, { button: 0, clientX: 10, clientY: 10 });
    fireEvent.pointerUp(avatar!, { button: 0, clientX: 10, clientY: 10 });

    const micBtn = screen.getByRole("button", { name: /hablar|talk/i });
    fireEvent.pointerDown(micBtn, { pointerId: 1 });
    expect(mockPttStart).toHaveBeenCalledTimes(1);

    fireEvent.pointerUp(micBtn, { pointerId: 1 });
    expect(mockPttStop).toHaveBeenCalledTimes(1);
  });

  it("mic button keyboard Space hold starts PTT and release stops PTT", async () => {
    const { container } = render(<DesktopCompanion />);
    const avatar = container.querySelector(".desktop-avatar");

    // Click to open
    fireEvent.pointerDown(avatar!, { button: 0, clientX: 10, clientY: 10 });
    fireEvent.pointerUp(avatar!, { button: 0, clientX: 10, clientY: 10 });

    const micBtn = screen.getByRole("button", { name: /hablar|talk/i });
    fireEvent.keyDown(micBtn, { key: " " });
    expect(mockPttStart).toHaveBeenCalledTimes(1);

    fireEvent.keyUp(micBtn, { key: " " });
    expect(mockPttStop).toHaveBeenCalledTimes(1);
  });

  it("window blur event conceals controls and stops active PTT", async () => {
    const nowSpy = vi.spyOn(Date, "now");
    const { container } = render(<DesktopCompanion />);
    const avatar = container.querySelector(".desktop-avatar");

    // Click to open
    fireEvent.pointerDown(avatar!, { button: 0, clientX: 10, clientY: 10 });
    fireEvent.pointerUp(avatar!, { button: 0, clientX: 10, clientY: 10 });
    expect(screen.getByRole("textbox")).toBeInTheDocument();

    // A genuine blur, well after the click that opened the controls.
    nowSpy.mockReturnValue(Date.now() + 5_000);
    fireEvent.blur(window);
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(mockPttStop).toHaveBeenCalled();
    nowSpy.mockRestore();
  });

  it("keeps the composer open when the activating first click is followed by a blur", async () => {
    const { container } = render(<DesktopCompanion />);
    const avatar = container.querySelector(".desktop-avatar");

    fireEvent.pointerDown(avatar!, { button: 0, clientX: 10, clientY: 10 });
    fireEvent.pointerUp(avatar!, { button: 0, clientX: 10, clientY: 10 });
    expect(screen.getByRole("textbox")).toBeInTheDocument();

    // WebView2 can bounce focus while the no-activate window is activated by
    // the click; that blur must not collapse the composer.
    fireEvent.blur(window);
    expect(screen.getByRole("textbox")).toBeInTheDocument();
  });

  it("releases the desktop-state listener even when the subscription resolves after unmount", async () => {
    const unlisten = vi.fn();
    let resolveListen!: (fn: () => void) => void;
    mockOnDesktopState.mockReturnValue(new Promise<() => void>((resolve) => (resolveListen = resolve)));

    const { unmount } = render(<DesktopCompanion />);
    unmount();
    expect(unlisten).not.toHaveBeenCalled();
    resolveListen(unlisten);
    await waitFor(() => expect(unlisten).toHaveBeenCalledTimes(1));
  });

  it("dragging avatar (hypot >= 6px) triggers native startDragging and does not reveal controls", async () => {
    const { container } = render(<DesktopCompanion />);
    const avatar = container.querySelector(".desktop-avatar");

    fireEvent.pointerDown(avatar!, { button: 0, clientX: 10, clientY: 10 });
    // Drag by 6px horizontally
    fireEvent.pointerMove(avatar!, { clientX: 16, clientY: 10 });

    await waitFor(() => {
      expect(mockStartDragging).toHaveBeenCalled();
    });

    fireEvent.pointerUp(avatar!, { clientX: 16, clientY: 10 });
    // Controls should not have opened
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("pointer cancel resets pointer state and does not reveal controls", async () => {
    const { container } = render(<DesktopCompanion />);
    const avatar = container.querySelector(".desktop-avatar");

    fireEvent.pointerDown(avatar!, { button: 0, clientX: 10, clientY: 10 });
    fireEvent.pointerCancel(avatar!, { clientX: 10, clientY: 10 });
    fireEvent.pointerUp(avatar!, { clientX: 10, clientY: 10 });

    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("controls container specifies no-drag region so input and mic do not drag", async () => {
    const { container } = render(<DesktopCompanion />);
    const avatar = container.querySelector(".desktop-avatar");

    fireEvent.pointerDown(avatar!, { button: 0, clientX: 10, clientY: 10 });
    fireEvent.pointerUp(avatar!, { button: 0, clientX: 10, clientY: 10 });

    const input = screen.getByRole("textbox");
    const controlsContainer = input.closest(".desktop-controls");
    expect(controlsContainer).not.toBeNull();
    expect(controlsContainer).toHaveAttribute("data-no-drag", "true");
  });

  it("chat turn submission succeeds and clears draft", async () => {
    mockSendChatTurn.mockResolvedValueOnce({ ok: true });
    const { container } = render(<DesktopCompanion />);
    const avatar = container.querySelector(".desktop-avatar");

    fireEvent.pointerDown(avatar!, { button: 0, clientX: 10, clientY: 10 });
    fireEvent.pointerUp(avatar!, { button: 0, clientX: 10, clientY: 10 });

    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "Hello Kira" } });

    const sendBtn = screen.getByRole("button", { name: /enviar|send/i });
    expect(sendBtn).not.toBeDisabled();

    fireEvent.click(sendBtn);

    await waitFor(() => {
      expect(mockSendChatTurn).toHaveBeenCalledWith("Hello Kira");
    });
    await waitFor(() => {
      expect((input as HTMLInputElement).value).toBe("");
    });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("broadcasts an accepted operator turn with a stable ID and pre-send timestamp", async () => {
    const receiver = new BroadcastChannel("opencohost-companion-operator-turn");
    const received: unknown[] = [];
    receiver.addEventListener("message", (event) => received.push(event.data));
    let accept!: (value: { ok: boolean }) => void;
    mockSendChatTurn.mockImplementationOnce(() => new Promise((resolve) => { accept = resolve; }));
    try {
      const { container } = render(<DesktopCompanion />);
      const avatar = container.querySelector(".desktop-avatar")!;
      fireEvent.pointerDown(avatar, { button: 0, clientX: 10, clientY: 10 });
      fireEvent.pointerUp(avatar, { button: 0, clientX: 10, clientY: 10 });
      fireEvent.change(screen.getByRole("textbox"), { target: { value: "Hello from Companion" } });

      const beforeSend = Date.now();
      fireEvent.click(screen.getByRole("button", { name: /enviar|send/i }));
      expect(received).toHaveLength(0);
      const beforeAccept = Date.now();
      accept({ ok: true });

      await waitFor(() => expect(received).toHaveLength(1));
      expect(received[0]).toEqual({
        type: "operator-turn-accepted",
        id: expect.any(String),
        text: "Hello from Companion",
        ts: expect.any(Number),
      });
      const turn = received[0] as { id: string; ts: number };
      expect(turn.id).not.toBe("");
      expect(turn.ts).toBeGreaterThanOrEqual(beforeSend);
      expect(turn.ts).toBeLessThanOrEqual(beforeAccept);
    } finally {
      receiver.close();
    }
  });

  it("does not broadcast a rejected operator turn", async () => {
    const receiver = new BroadcastChannel("opencohost-companion-operator-turn");
    const received: unknown[] = [];
    receiver.addEventListener("message", (event) => received.push(event.data));
    mockSendChatTurn.mockRejectedValueOnce(new Error("Network disconnect"));
    try {
      const { container } = render(<DesktopCompanion />);
      const avatar = container.querySelector(".desktop-avatar")!;
      fireEvent.pointerDown(avatar, { button: 0, clientX: 10, clientY: 10 });
      fireEvent.pointerUp(avatar, { button: 0, clientX: 10, clientY: 10 });
      fireEvent.change(screen.getByRole("textbox"), { target: { value: "Rejected turn" } });
      fireEvent.click(screen.getByRole("button", { name: /enviar|send/i }));

      await screen.findByRole("alert");
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(received).toHaveLength(0);
    } finally {
      receiver.close();
    }
  });

  it("chat turn submission failure retains draft and displays error alert", async () => {
    mockSendChatTurn.mockRejectedValueOnce(new Error("Network disconnect"));
    const { container } = render(<DesktopCompanion />);
    const avatar = container.querySelector(".desktop-avatar");

    fireEvent.pointerDown(avatar!, { button: 0, clientX: 10, clientY: 10 });
    fireEvent.pointerUp(avatar!, { button: 0, clientX: 10, clientY: 10 });

    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "Failed turn draft" } });

    const sendBtn = screen.getByRole("button", { name: /enviar|send/i });
    fireEvent.click(sendBtn);

    await waitFor(() => {
      expect(mockSendChatTurn).toHaveBeenCalledWith("Failed turn draft");
    });
    await waitFor(() => {
      expect(screen.getByRole("alert")).toBeInTheDocument();
    });
    expect((input as HTMLInputElement).value).toBe("Failed turn draft");
  });

  it("empty or whitespace draft keeps send button disabled", async () => {
    const { container } = render(<DesktopCompanion />);
    const avatar = container.querySelector(".desktop-avatar");

    fireEvent.pointerDown(avatar!, { button: 0, clientX: 10, clientY: 10 });
    fireEvent.pointerUp(avatar!, { button: 0, clientX: 10, clientY: 10 });

    const sendBtn = screen.getByRole("button", { name: /enviar|send/i });
    expect(sendBtn).toBeDisabled();

    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "    " } });
    expect(sendBtn).toBeDisabled();
  });

  it("typing spaces in text input does not trigger PTT", async () => {
    const { container } = render(<DesktopCompanion />);
    const avatar = container.querySelector(".desktop-avatar");

    fireEvent.pointerDown(avatar!, { button: 0, clientX: 10, clientY: 10 });
    fireEvent.pointerUp(avatar!, { button: 0, clientX: 10, clientY: 10 });

    const input = screen.getByRole("textbox");
    fireEvent.keyDown(input, { key: " " });
    expect(mockPttStart).not.toHaveBeenCalled();
  });

  it("native drag rejection does not cause accidental click or toggle controls", async () => {
    mockStartDragging.mockRejectedValueOnce(new Error("OS drag refused"));
    const { container } = render(<DesktopCompanion />);
    const avatar = container.querySelector(".desktop-avatar");

    fireEvent.pointerDown(avatar!, { button: 0, clientX: 10, clientY: 10 });
    fireEvent.pointerMove(avatar!, { clientX: 25, clientY: 10 });

    await waitFor(() => {
      expect(mockStartDragging).toHaveBeenCalled();
    });

    fireEvent.pointerUp(avatar!, { clientX: 25, clientY: 10 });
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("typing slash or bang triggers the command launcher popover and listbox", async () => {
    const { container } = render(<DesktopCompanion />);
    const avatar = container.querySelector(".desktop-avatar");

    // Click to open
    fireEvent.pointerDown(avatar!, { button: 0, clientX: 10, clientY: 10 });
    fireEvent.pointerUp(avatar!, { button: 0, clientX: 10, clientY: 10 });

    const input = screen.getByRole("textbox");
    expect(input).toHaveAttribute("aria-expanded", "false");

    // Type slash
    fireEvent.change(input, { target: { value: "/" } });

    await waitFor(() => {
      expect(screen.getByRole("listbox")).toBeInTheDocument();
      expect(input).toHaveAttribute("aria-expanded", "true");
    });

    // Change to bang
    fireEvent.change(input, { target: { value: "!" } });

    await waitFor(() => {
      expect(screen.getByRole("listbox")).toBeInTheDocument();
      expect(input).toHaveAttribute("aria-expanded", "true");
    });
  });

  it("slash commands disable send button and prevent submitting as regular chat turn", async () => {
    const { container } = render(<DesktopCompanion />);
    const avatar = container.querySelector(".desktop-avatar");

    // Click to open
    fireEvent.pointerDown(avatar!, { button: 0, clientX: 10, clientY: 10 });
    fireEvent.pointerUp(avatar!, { button: 0, clientX: 10, clientY: 10 });

    const input = screen.getByRole("textbox");
    const sendBtn = screen.getByRole("button", { name: /enviar|send/i });

    // Type a slash command
    fireEvent.change(input, { target: { value: "/agenda" } });
    expect(sendBtn).toBeDisabled();

    // Directly submit form
    fireEvent.submit(input.closest("form")!);
    expect(mockSendChatTurn).not.toHaveBeenCalled();
  });

  it("pressing Escape while command popover is open closes popover without closing controls", async () => {
    const { container } = render(<DesktopCompanion />);
    const avatar = container.querySelector(".desktop-avatar");

    // Click to open
    fireEvent.pointerDown(avatar!, { button: 0, clientX: 10, clientY: 10 });
    fireEvent.pointerUp(avatar!, { button: 0, clientX: 10, clientY: 10 });

    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "/musica" } });

    await waitFor(() => {
      expect(screen.getByRole("listbox")).toBeInTheDocument();
    });

    // Escape closes popover and resets draft
    fireEvent.keyDown(input, { key: "Escape" });

    await waitFor(() => {
      expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    });
    // Controls strip remains open
    expect(screen.getByRole("textbox")).toBeInTheDocument();
    expect((screen.getByRole("textbox") as HTMLInputElement).value).toBe("");
  });

  it("zoom framing mode buttons switch active mode and save to localStorage", async () => {
    const { container } = render(<DesktopCompanion />);
    const avatar = container.querySelector(".desktop-avatar");

    fireEvent.pointerDown(avatar!, { button: 0, clientX: 10, clientY: 10 });
    fireEvent.pointerUp(avatar!, { button: 0, clientX: 10, clientY: 10 });

    const halfBtn = screen.getByRole("button", { name: "Medio" });
    expect(halfBtn).toHaveAttribute("aria-pressed", "false");

    fireEvent.click(halfBtn);
    expect(halfBtn).toHaveAttribute("aria-pressed", "true");
    expect(localStorage.getItem("oc-desktop-companion-zoom")).toBe("half");
  });

  it("selecting /musica command renders without throwing usePlaybackContext error", async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const { container } = render(
      React.createElement(
        QueryClientProvider,
        { client: queryClient },
        React.createElement(DesktopCompanion)
      )
    );
    const avatar = container.querySelector(".desktop-avatar");

    fireEvent.pointerDown(avatar!, { button: 0, clientX: 10, clientY: 10 });
    fireEvent.pointerUp(avatar!, { button: 0, clientX: 10, clientY: 10 });

    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "/musica" } });

    await waitFor(() => {
      expect(screen.getByRole("listbox")).toBeInTheDocument();
    });

    const musicaOption = screen.getByText(/controla la música/i);
    fireEvent.click(musicaOption);

    await waitFor(() => {
      expect(screen.getByRole("dialog")).toBeInTheDocument();
    });
    expect(screen.getByRole("button", { name: "Cerrar" })).toBeInTheDocument();
  });
});

describe("DesktopCompanion vision look (V1.16)", () => {
  function serveVision(enabled: boolean, state: string, extra: Record<string, unknown> = {}) {
    const calls = { looks: 0 };
    server.use(
      http.get(`${API_BASE_URL}/api/vision`, () =>
        HttpResponse.json({
          enabled,
          look_on_ptt: false,
          capture_delay_s: 0,
          rule_gate_enabled: false,
          model: "m",
          port: 1,
          describe_timeout_s: 8,
          status: { daemon_state: "running", model_installed: true, capture_available: true, armed: false, looking: false, state, ...extra }
        })
      ),
      http.post(`${API_BASE_URL}/api/vision/look`, () => {
        calls.looks += 1;
        return HttpResponse.json({ armed: true });
      })
    );
    return calls;
  }

  async function openControls(container: HTMLElement) {
    const avatar = container.querySelector(".desktop-avatar");
    fireEvent.pointerDown(avatar!, { button: 0, clientX: 10, clientY: 10 });
    fireEvent.pointerUp(avatar!, { button: 0, clientX: 10, clientY: 10 });
  }

  beforeEach(() => {
    vi.clearAllMocks();
    useVisionPhaseStore.setState({ phase: "idle" });
    mockGetDesktopState.mockResolvedValue({ enabled: true, visible: true, ready: false, model: "avatar.vrm", revision: 1, generation: 1, error: null });
    mockOnDesktopState.mockResolvedValue(() => {});
    mockDesktopReady.mockResolvedValue({});
    mockReconcileDesktop.mockResolvedValue({});
    mockBootstrapBackend.mockResolvedValue({ backendError: null });
  });

  it("renders no look button; spoken or typed look requests trigger it instead", async () => {
    const calls = serveVision(true, "ready");
    const { container } = render(<DesktopCompanion />);
    await openControls(container);
    await act(async () => {});
    expect(screen.queryByRole("button", { name: /mira esto|look at this|visi[oó]n desactivada|vision off/i })).toBeNull();
    expect(calls.looks).toBe(0);
  });

  it("shows no phase pill in any look phase; TTS and the phone pose already signal it", async () => {
    serveVision(true, "ready");
    render(<DesktopCompanion />);
    await act(async () => {});
    for (const phase of ["looking", "describing", "failed", "done"] as const) {
      act(() => useVisionPhaseStore.getState().setPhase(phase));
      expect(screen.queryByRole("status")).toBeNull();
    }
  });
});

describe("DesktopCompanion vision look commands (/mira, !look)", () => {
  function serveVision(enabled: boolean, state: string, lookStatus = 200) {
    const calls = { looks: [] as Array<Record<string, unknown>>, order: [] as string[] };
    server.use(
      http.get(`${API_BASE_URL}/api/vision`, () =>
        HttpResponse.json({
          enabled,
          look_on_ptt: false,
          capture_delay_s: 0,
          rule_gate_enabled: false,
          model: "m",
          port: 1,
          describe_timeout_s: 8,
          status: { daemon_state: enabled ? "running" : "stopped", model_installed: true, capture_available: true, armed: false, looking: false, state }
        })
      ),
      http.post(`${API_BASE_URL}/api/vision/look`, async ({ request }) => {
        const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
        calls.looks.push(body);
        calls.order.push("look");
        if (lookStatus >= 400) {
          return HttpResponse.json({ detail: "look failed" }, { status: lookStatus });
        }
        return HttpResponse.json({ armed: true });
      })
    );
    return calls;
  }

  async function openControls(container: HTMLElement) {
    const avatar = container.querySelector(".desktop-avatar");
    fireEvent.pointerDown(avatar!, { button: 0, clientX: 10, clientY: 10 });
    fireEvent.pointerUp(avatar!, { button: 0, clientX: 10, clientY: 10 });
  }

  beforeEach(() => {
    vi.clearAllMocks();
    useVisionPhaseStore.setState({ phase: "idle" });
    mockSendChatTurn.mockImplementation(async () => ({ ok: true }));
    mockGetDesktopState.mockResolvedValue({ enabled: true, visible: true, ready: false, model: "avatar.vrm", revision: 1, generation: 1, error: null });
    mockOnDesktopState.mockResolvedValue(() => {});
    mockDesktopReady.mockResolvedValue({});
    mockReconcileDesktop.mockResolvedValue({});
    mockBootstrapBackend.mockResolvedValue({ backendError: null });
  });

  it("does not open slash command palette for /mira, /mira clip, /mira texto, or !look, while /m and /agenda still open it", async () => {
    serveVision(true, "ready");
    const { container } = render(<DesktopCompanion />);
    await openControls(container);

    const input = screen.getByRole("textbox");
    const sendBtn = screen.getByRole("button", { name: /enviar|send/i });

    fireEvent.change(input, { target: { value: "/m" } });
    await waitFor(() => expect(screen.getByRole("listbox")).toBeInTheDocument());

    for (const cmd of ["/mira", "/mira clip", "/mira texto", "!look", "/look text read this"]) {
      fireEvent.change(input, { target: { value: cmd } });
      expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
      expect(input).toHaveAttribute("aria-expanded", "false");
      expect(sendBtn).not.toBeDisabled();
    }

    fireEvent.change(input, { target: { value: "/agenda" } });
    await waitFor(() => expect(screen.getByRole("listbox")).toBeInTheDocument());
    expect(sendBtn).toBeDisabled();
  });

  it("bare !look arms look without sending a chat turn and clears draft", async () => {
    const calls = serveVision(true, "ready");
    const { container } = render(<DesktopCompanion />);
    await openControls(container);
    await new Promise((r) => setTimeout(r, 30));

    const input = screen.getByRole("textbox") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "!look" } });
    fireEvent.submit(input.closest("form")!);

    await waitFor(() => expect(calls.looks).toHaveLength(1));
    expect(calls.looks[0]).toEqual({});
    expect(mockSendChatTurn).not.toHaveBeenCalled();
    await waitFor(() => expect(input.value).toBe(""));
  });

  it("/mira clip <question> arms clip look first, then sends only the remainder and broadcasts it", async () => {
    const calls = serveVision(true, "ready");
    const receiver = new BroadcastChannel("opencohost-companion-operator-turn");
    const received: Array<{ text: string }> = [];
    receiver.addEventListener("message", (e) => received.push(e.data as { text: string }));
    mockSendChatTurn.mockImplementation(async () => {
      calls.order.push("turn");
      return { ok: true };
    });

    try {
      const { container } = render(<DesktopCompanion />);
      await openControls(container);
      await new Promise((r) => setTimeout(r, 30));

      const input = screen.getByRole("textbox") as HTMLInputElement;
      fireEvent.change(input, { target: { value: "/mira clip que esta pasando" } });
      fireEvent.submit(input.closest("form")!);

      await waitFor(() => expect(mockSendChatTurn).toHaveBeenCalledWith("que esta pasando"));
      expect(calls.looks).toEqual([{ mode: "clip" }]);
      expect(calls.order).toEqual(["look", "turn"]);
      await waitFor(() => expect(received.map((m) => m.text)).toEqual(["que esta pasando"]));
      await waitFor(() => expect(input.value).toBe(""));
    } finally {
      receiver.close();
    }
  });

  it("/mira texto <question> arms text look then sends remainder", async () => {
    const calls = serveVision(true, "ready");
    const { container } = render(<DesktopCompanion />);
    await openControls(container);
    await new Promise((r) => setTimeout(r, 30));

    const input = screen.getByRole("textbox") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "/mira texto lee la pantalla" } });
    fireEvent.submit(input.closest("form")!);

    await waitFor(() => expect(mockSendChatTurn).toHaveBeenCalledWith("lee la pantalla"));
    expect(calls.looks).toEqual([{ mode: "text" }]);
  });

  it("blocks /mira when vision is not ready, preserves draft, and surfaces alert until edited", async () => {
    const calls = serveVision(false, "off");
    const { container } = render(<DesktopCompanion />);
    await openControls(container);
    await new Promise((r) => setTimeout(r, 30));

    const input = screen.getByRole("textbox") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "/mira que ves" } });
    fireEvent.submit(input.closest("form")!);

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/visi[oó]n no est[aá] lista|vision isn't ready/i);
    expect(calls.looks).toHaveLength(0);
    expect(mockSendChatTurn).not.toHaveBeenCalled();
    expect(input.value).toBe("/mira que ves");

    fireEvent.change(input, { target: { value: "hola" } });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("keeps draft and shows alert when POST /api/vision/look fails", async () => {
    const calls = serveVision(true, "ready", 500);
    const { container } = render(<DesktopCompanion />);
    await openControls(container);
    await new Promise((r) => setTimeout(r, 30));

    const input = screen.getByRole("textbox") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "/mira que ves" } });
    fireEvent.submit(input.closest("form")!);

    await waitFor(() => expect(calls.looks).toHaveLength(1));
    expect(await screen.findByRole("alert")).toHaveTextContent(/visi[oó]n no est[aá] lista|vision isn't ready/i);
    expect(mockSendChatTurn).not.toHaveBeenCalled();
    expect(input.value).toBe("/mira que ves");
  });
});
