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

/**
 * Prototype-only bridge.
 *
 * The production Python engine should remain the source of truth. This UI shell should later talk to
 * the engine through a narrow process/API boundary instead of importing Python internals into React.
 */
export function createPythonEngineBridge(initialState: CohostState): PythonEngineBridge {
  return {
    async getState() {
      return initialState;
    },
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
