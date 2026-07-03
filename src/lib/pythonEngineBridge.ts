import { getStatus } from "../api/client.js";

export type EngineReadiness = "ready" | "warming" | "degraded" | "offline";
export type BridgeMode = "demo" | "http" | "sidecar";

// No se de donde salio este archivo.
export interface CohostState {
  engine: {
    mode: BridgeMode;
    readiness: EngineReadiness;
    label: string;
    detail: string;
  };
  kira: {
    name: string;
    mood: "focused" | "speaking" | "listening" | "thinking" | "recovering";
    currentAction: string;
  };
  agenda: {
    activeTitle: string;
    activeGoal: string;
    elapsedSeconds: number;
    queue: string[];
  };
  cards: Array<{
    title: string;
    source: string;
    summary: string;
  }>;
  guardrails: Array<{
    label: string;
    state: "ok" | "watch" | "blocked";
  }>;
  transcript: Array<{
    speaker: "Kira" | "Operator" | "Viewer";
    text: string;
  }>;
}

export interface PythonEngineBridge {
  getState(): Promise<CohostState>;
  sendOperatorMessage(message: string): Promise<void>;
  pauseAgenda(): Promise<void>;
  resumeAgenda(): Promise<void>;
  takeover(): Promise<void>;
}

function inertNoOps() {
  return {
    async sendOperatorMessage(message: string) {
      console.info("[prototype] operator message queued for Python engine", message);
    },
    async pauseAgenda() {
      console.info("[prototype] pause agenda requested");
    },
    async resumeAgenda() {
      console.info("[prototype] resume agenda requested");
    },
    async takeover() {
      console.info("[prototype] operator takeover requested");
    }
  };
}

function createDemoBridge(initialState: CohostState): PythonEngineBridge {
  return {
    async getState() {
      return initialState;
    },
    ...inertNoOps()
  };
}

/**
 * Thin mapping only (design D2/YAGNI): the flat `/api/status` contract can't
 * express agenda/cards/guardrails/transcript, so `http` mode overlays only
 * `engine.*` onto the provided template and leaves the rest untouched.
 * Nothing in P1 calls getState() for rendering (components use the TanStack
 * Query hooks in src/api/* directly, per design D1) — this exists to honor
 * the bridge seam contract, not as a live data path.
 */
function createHttpBridge(template: CohostState): PythonEngineBridge {
  return {
    async getState() {
      const status = await getStatus();
      return {
        ...template,
        engine: {
          ...template.engine,
          mode: "http",
          readiness: status.is_ready ? "ready" : "warming",
          label: status.current_model ?? template.engine.label
        }
      };
    },
    ...inertNoOps()
  };
}

/**
 * Prototype bridge, mode-selected (demo | http). `demo` behavior is
 * unchanged. The production Python engine should remain the source of
 * truth; this UI shell talks to it through the narrow HTTP boundary in
 * src/api/client.ts (http mode) instead of importing Python internals.
 */
export function createPythonEngineBridge(mode: BridgeMode, initialState: CohostState): PythonEngineBridge {
  if (mode === "http") {
    return createHttpBridge(initialState);
  }
  return createDemoBridge(initialState);
}
