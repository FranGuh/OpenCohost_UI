import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setApiToken } from "../../api/client.js";
import { useAvatarPresentationStore } from "../../store/avatarPresentationStore.js";
import { API_BASE_URL } from "../../test/handlers.js";
import { server } from "../../test/server.js";
import { KiraCover } from "./KiraCover.js";

const stageCallbacks = vi.hoisted(() => ({
  isAudioActive: undefined as (() => boolean) | undefined,
  sample: undefined as ((frameId?: number, deltaSeconds?: number) => number) | undefined,
}));

// Mock Three.js / WebGL stage so tests in jsdom don't fail on canvas getContext
vi.mock("../avatar-vrm/components/VrmStage.js", () => ({
  VrmStage: ({
    url,
    onError,
    active,
    isAudioActive,
    sample,
  }: {
    url: string;
    onError?: (msg: string) => void;
    active?: boolean;
    isAudioActive?: () => boolean;
    sample?: (frameId?: number, deltaSeconds?: number) => number;
  }) => {
    stageCallbacks.isAudioActive = isAudioActive;
    stageCallbacks.sample = sample;
    return (
      <div data-testid="vrm-stage" data-url={url} data-active={String(active)}>
        VRM Stage Mock
        <button type="button" data-testid="trigger-stage-error" onClick={() => onError?.("WebGL failed")}>
          Fail
        </button>
      </div>
    );
  },
}));

function renderCover() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    React.createElement(QueryClientProvider, { client: queryClient }, React.createElement(KiraCover))
  );
}

describe("KiraCover Presentation Mode (2D / 3D)", () => {
  beforeEach(() => {
    window.localStorage.clear();
    useAvatarPresentationStore.setState({ mode: "2d", selectedModel: "" });
  });

  it("renders 2D image avatar by default when mode is 2d", async () => {
    renderCover();
    await waitFor(() => {
      const img = screen.getByRole("img", { name: /Avatar de Kira/ });
      expect(img).toBeInTheDocument();
    });
    expect(screen.queryByTestId("vrm-stage")).not.toBeInTheDocument();
  });

  it("renders VrmStage when mode is 3d and a model is selected", async () => {
    useAvatarPresentationStore.setState({ mode: "3d", selectedModel: "Kira_3D.vrm" });
    renderCover();
    await waitFor(() => {
      const stage = screen.getByTestId("vrm-stage");
      expect(stage).toBeInTheDocument();
      expect(stage.getAttribute("data-url")).toContain("Kira_3D.vrm");
    });
    expect(screen.queryByRole("img", { name: /Avatar de Kira/ })).not.toBeInTheDocument();
  });

  it("gracefully falls back to 2D image if mode is 3d but no model is selected", async () => {
    useAvatarPresentationStore.setState({ mode: "3d", selectedModel: "" });
    renderCover();
    await waitFor(() => {
      const img = screen.getByRole("img", { name: /Avatar de Kira/ });
      expect(img).toBeInTheDocument();
    });
    expect(screen.queryByTestId("vrm-stage")).not.toBeInTheDocument();
  });

  it("gracefully falls back to 2D image when VrmStage reports error, and resets on model change", async () => {
    useAvatarPresentationStore.setState({ mode: "3d", selectedModel: "Kira_3D.vrm" });
    renderCover();
    await waitFor(() => {
      expect(screen.getByTestId("vrm-stage")).toBeInTheDocument();
    });

    // Trigger WebGL failure
    fireEvent.click(screen.getByTestId("trigger-stage-error"));

    // Degrades to 2D image
    await waitFor(() => {
      expect(screen.getByRole("img", { name: /Avatar de Kira/ })).toBeInTheDocument();
      expect(screen.queryByTestId("vrm-stage")).not.toBeInTheDocument();
    });

    // Selecting another model resets error and remounts 3D stage
    act(() => {
      useAvatarPresentationStore.setState({ selectedModel: "Kira_Casual.vrm" });
    });
    await waitFor(() => {
      expect(screen.getByTestId("vrm-stage")).toBeInTheDocument();
    });
  });
});

describe("KiraCover stage activity is self-healing", () => {
  let hidden = false;

  beforeEach(() => {
    window.localStorage.clear();
    hidden = false;
    Object.defineProperty(document, "hidden", { configurable: true, get: () => hidden });
    useAvatarPresentationStore.setState({ mode: "3d", selectedModel: "Kira_3D.vrm" });
  });

  afterEach(() => {
    vi.useRealTimers();
    delete (document as { hidden?: boolean }).hidden;
  });

  async function hideStage() {
    renderCover();
    await waitFor(() => expect(screen.getByTestId("vrm-stage").getAttribute("data-active")).toBe("true"));
    hidden = true;
    act(() => { document.dispatchEvent(new Event("visibilitychange")); });
    await waitFor(() => expect(screen.getByTestId("vrm-stage").getAttribute("data-active")).toBe("false"));
  }

  it("recovers from document.hidden on pageshow", async () => {
    await hideStage();
    hidden = false;
    act(() => { window.dispatchEvent(new Event("pageshow")); });
    await waitFor(() => expect(screen.getByTestId("vrm-stage").getAttribute("data-active")).toBe("true"));
  });

  it("recovers from document.hidden on window focus", async () => {
    await hideStage();
    hidden = false;
    act(() => { window.dispatchEvent(new Event("focus")); });
    await waitFor(() => expect(screen.getByTestId("vrm-stage").getAttribute("data-active")).toBe("true"));
  });

  it("does not stay inactive when the becoming-visible event is missed entirely", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    await hideStage();
    hidden = false; // no visibilitychange/focus/pageshow is ever dispatched
    act(() => { vi.advanceTimersByTime(5_000); });
    vi.useRealTimers();
    await waitFor(() => expect(screen.getByTestId("vrm-stage").getAttribute("data-active")).toBe("true"));
  });
});

describe("KiraCover lip-sync recovery on slow VM startup and AudioContext suspension", () => {
  function installFakeAudioContext(initialState: "running" | "suspended", canUnlock = () => true) {
    const listeners = new Map<string, Set<() => void>>();
    const node = () => ({ connect: vi.fn(), disconnect: vi.fn() });
    const fakeCtx = {
      state: initialState as AudioContextState,
      currentTime: 0,
      destination: {},
      addEventListener: (event: string, cb: () => void) => {
        if (!listeners.has(event)) listeners.set(event, new Set());
        listeners.get(event)!.add(cb);
      },
      removeEventListener: (event: string, cb: () => void) => {
        listeners.get(event)?.delete(cb);
      },
      resume: vi.fn(async () => {
        if (canUnlock()) {
          fakeCtx.state = "running";
          listeners.get("statechange")?.forEach((cb) => cb());
        }
      }),
      close: vi.fn(async () => {
        fakeCtx.state = "closed";
      }),
      decodeAudioData: vi.fn(async () => ({ duration: 3, sampleRate: 48000 })),
      createBufferSource: () => ({ ...node(), buffer: null, start: vi.fn(), stop: vi.fn(), onended: null }),
      createAnalyser: () => ({ ...node(), fftSize: 0, getFloatTimeDomainData: (data: Float32Array) => data.fill(0.3) }),
      createGain: () => ({ ...node(), gain: { value: 1 } }),
    };
    vi.stubGlobal("AudioContext", vi.fn(() => fakeCtx));
    return fakeCtx;
  }

  beforeEach(() => {
    window.localStorage.clear();
    setApiToken(null);
    stageCallbacks.isAudioActive = undefined;
    stageCallbacks.sample = undefined;
    useAvatarPresentationStore.setState({ mode: "3d", selectedModel: "Kira_3D.vrm" });
  });

  afterEach(() => {
    setApiToken(null);
    vi.unstubAllGlobals();
  });

  it("resumes AudioContext on keyboard or second interaction when initial click does not unlock audio", async () => {
    server.use(
      http.get(`${API_BASE_URL}/api/avatar/vrm/audio/state`, () =>
        HttpResponse.json({ sequence: 1, active: true, elapsed_ms: 100 })
      ),
      http.get(`${API_BASE_URL}/api/avatar/vrm/audio/last`, () =>
        new HttpResponse(new ArrayBuffer(8), { status: 200, headers: { "Content-Type": "audio/wav" } })
      )
    );
    setApiToken("op-secret");
    let allowUnlock = false;
    const fakeCtx = installFakeAudioContext("suspended", () => allowUnlock);

    const view = renderCover();
    await waitFor(() => expect(screen.getByTestId("vrm-stage")).toBeInTheDocument());

    // First click fails to unlock (e.g., focus/autoplay restriction); { once: true } would lose recovery forever.
    fireEvent.click(window);
    await waitFor(() => expect(fakeCtx.resume).toHaveBeenCalledTimes(2));
    expect(stageCallbacks.isAudioActive?.()).toBe(false);

    // User presses Enter/Space to chat or PTT without clicking again.
    allowUnlock = true;
    fireEvent.keyDown(window, { key: "Enter" });
    await waitFor(() => expect(stageCallbacks.isAudioActive?.()).toBe(true));
    expect(stageCallbacks.sample?.(1, 1 / 60)).toBeGreaterThan(0);
    view.unmount();
  });

  it("uses operator token populated after mount so first spoken chunk does not halt lip-sync with 401", async () => {
    let active = false;
    server.use(
      http.get(`${API_BASE_URL}/api/avatar/vrm/audio/state`, () =>
        HttpResponse.json({ sequence: active ? 1 : 0, active, elapsed_ms: active ? 100 : 0 })
      ),
      http.get(`${API_BASE_URL}/api/avatar/vrm/audio/last`, ({ request }) => {
        if (request.headers.get("authorization") !== "Bearer late-token") {
          return HttpResponse.json({ detail: "unauthorized" }, { status: 401 });
        }
        return new HttpResponse(new ArrayBuffer(8), { status: 200, headers: { "Content-Type": "audio/wav" } });
      })
    );
    installFakeAudioContext("running", () => true);

    // Mounted before bootstrapApiToken() finishes (cached token is null).
    const view = renderCover();
    await waitFor(() => expect(screen.getByTestId("vrm-stage")).toBeInTheDocument());

    // Bootstrap finishes and speech starts.
    setApiToken("late-token");
    active = true;

    await waitFor(() => expect(stageCallbacks.isAudioActive?.()).toBe(true), { timeout: 2000 });
    expect(stageCallbacks.sample?.(1, 1 / 60)).toBeGreaterThan(0);
    view.unmount();
  });
});
