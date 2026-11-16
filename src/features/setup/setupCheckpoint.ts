import type { SetupCheckpoint, SetupCheckpointBody, SetupCheckpointAnswers } from "../../api/setup.js";
import type { TKey } from "../../i18n/t.js";
import type { LocalOllamaAvailability } from "./SetupSteps.js";
import {
  canAdvance,
  initialSetupState,
  stepGroup,
  stepPath,
  type EngineChoice,
  type SetupMachineState,
  type SetupStep,
  type TestVerdict,
  type VoiceAnswer
} from "./setupMachine.js";

/**
 * Setup checkpoints (setup-wizard-simple S10). Pure: no DOM, no network.
 *
 * - `toCheckpoint` turns the machine state plus the few answers that live
 *   outside it (language, narrator, voice kind, avatar) into the non-secret
 *   payload the backend stores. Keys never enter the machine, so never here.
 * - `restoreCheckpoint` rebuilds the machine from a saved checkpoint and checks
 *   every answer against what the PC looks like now: a resume lands on the
 *   earliest screen whose answer no longer holds, with one plain reason.
 *   It never trusts the shape of the saved object.
 */
export const CHECKPOINT_VERSION = 1;

const KNOWN_STEPS: ReadonlySet<string> = new Set<SetupStep>([
  "language", "kiraLanguage", "narrator", "voice", "voiceSpeed", "voiceTest",
  "welcome", "hardware", "engine", "model", "apiKey", "fallback", "test",
  "personalize", "avatar", "profile", "search", "liveaudio", "theme", "done"
]);

function normalizeSavedStep(rawStep: unknown): SetupStep | null {
  if (rawStep === "voiceChoice") return "voiceSpeed";
  return typeof rawStep === "string" && KNOWN_STEPS.has(rawStep) ? (rawStep as SetupStep) : null;
}

export interface CheckpointExtras {
  language: "es" | "en" | null;
  hearKira: boolean | null;
  voiceKind: "piper" | "edge" | null;
  avatar: "3d" | "2d" | null;
}

export function toCheckpoint(state: SetupMachineState, extras: CheckpointExtras): SetupCheckpointBody {
  return {
    version: CHECKPOINT_VERSION,
    step: state.step,
    answers: {
      language: extras.language,
      hear_kira: extras.hearKira,
      engine: state.engine,
      model: state.model,
      model_ready: state.modelReady,
      cloud_preset: state.cloud?.preset ?? null,
      cloud_model: state.cloud?.model ?? null,
      voice: state.voice,
      voice_kind: extras.voiceKind,
      test_verdict: state.testVerdict,
      personalize: state.personalize,
      avatar: extras.avatar
    }
  };
}

/** What the PC looks like now. `null`/`undefined`/"unknown" means "could not tell": the answer is kept. */
export interface LiveFacts {
  hasGpu: boolean | null;
  ollama: LocalOllamaAvailability;
  /** Installed Ollama models; null when unknown. */
  installed: readonly string[] | null;
  /** The active cloud profile; null when the active provider is local or missing, undefined when unknown. */
  activeCloud: { preset: string; keySet: boolean } | null | undefined;
  piperAvailable: boolean | null;
  /** Live "Piper only" voice setting; null when unknown. */
  ttsLocalOnly: boolean | null;
  /** VRM files on disk and the one selected; null when unknown. */
  vrm: { files: readonly string[]; selected: string | null } | null;
}

export type ResumeReason =
  | "setup.resume.reason.step"
  | "setup.resume.reason.ollama"
  | "setup.resume.reason.gpu"
  | "setup.resume.reason.model"
  | "setup.resume.reason.cloudKey"
  | "setup.resume.reason.piper"
  | "setup.resume.reason.avatar";

export interface RestoredCheckpoint {
  state: SetupMachineState;
  /** One-line reason when a saved answer no longer holds (or the step is gone); null otherwise. */
  reason: (ResumeReason & TKey) | null;
  language: "es" | "en" | null;
  hearKira: boolean | null;
  avatar: "3d" | "2d" | null;
}

// ─── Defensive readers: a checkpoint is data from disk, never trusted ───────

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[]): T | null {
  return typeof value === "string" && (allowed as readonly string[]).includes(value) ? (value as T) : null;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

function flag(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

type Answers = { [K in keyof SetupCheckpointAnswers]: SetupCheckpointAnswers[K] };

function readAnswers(raw: unknown): Answers {
  const a = record(raw);
  return {
    language: oneOf(a.language, ["es", "en"] as const),
    hear_kira: flag(a.hear_kira),
    engine: oneOf<EngineChoice>(a.engine, ["gpu", "cpu", "cloud"]),
    model: text(a.model),
    model_ready: a.model_ready === true,
    cloud_preset: text(a.cloud_preset),
    cloud_model: text(a.cloud_model),
    voice: oneOf<VoiceAnswer>(a.voice, ["unknown", "ok", "off"]) ?? "unknown",
    voice_kind: oneOf(a.voice_kind, ["piper", "edge"] as const),
    test_verdict: oneOf<TestVerdict>(a.test_verdict, ["passed", "slow", "failed"]),
    personalize: flag(a.personalize),
    avatar: oneOf(a.avatar, ["3d", "2d"] as const)
  };
}

function machineFromAnswers(answers: Answers, hasGpu: boolean, ollamaMissing = false): SetupMachineState {
  const engine = answers.engine;
  const local = engine === "gpu" || engine === "cpu";
  const cloud = engine === "cloud" && answers.cloud_preset && answers.cloud_model
    ? { preset: answers.cloud_preset, model: answers.cloud_model }
    : null;
  return {
    ...initialSetupState(),
    hasGpu,
    ollamaMissing,
    engine,
    model: local ? answers.model : null,
    modelReady: local && answers.model !== null && answers.model_ready,
    cloud,
    voice: answers.voice,
    localVoice: answers.voice_kind === "piper",
    testVerdict: answers.test_verdict,
    testSummary: answers.test_verdict
      ? { verdict: answers.test_verdict, firstTokenMs: null, tokensPerSecond: null, errorCode: null }
      : null,
    personalize: answers.personalize
  };
}

/** First block start (along the path) whose answer is still missing; "done" when nothing is. */
function nearestBlockStart(state: SetupMachineState): SetupStep {
  const path = stepPath(state.engine, state.personalize, state.localVoice, state.ollamaMissing);
  const missing = path.find((step) => step !== "done" && !canAdvance({ ...state, step }));
  return missing ? stepGroup(missing) : "done";
}

/** The saved UI language, applied as soon as the resume question shows. */
export function savedCheckpointLanguage(checkpoint: SetupCheckpoint): "es" | "en" | null {
  return readAnswers(record(checkpoint).answers).language;
}

/** Only a saved 3D avatar needs the VRM list read before resuming. */
export function checkpointNeedsVrm(checkpoint: SetupCheckpoint): boolean {
  const answers = readAnswers(record(checkpoint).answers);
  return answers.personalize === true && answers.avatar === "3d";
}

/** The screen a checkpoint would resume on, ignoring live state (for the "Continuar (<paso>)" label). */
export function checkpointResumeStep(checkpoint: SetupCheckpoint): SetupStep {
  const raw = record(checkpoint);
  const state = machineFromAnswers(readAnswers(raw.answers), false);
  return normalizeSavedStep(raw.step) ?? nearestBlockStart(state);
}

interface Invalid {
  step: SetupStep;
  reason: ResumeReason;
}

export function restoreCheckpoint(checkpoint: SetupCheckpoint, live: LiveFacts): RestoredCheckpoint {
  const raw = record(checkpoint);
  const answers = readAnswers(raw.answers);
  let state = machineFromAnswers(answers, live.hasGpu ?? false, live.ollama === "missing");
  const invalid: Invalid[] = [];
  const clearTest = () => {
    state = { ...state, testVerdict: null, testSummary: null };
  };

  // Brain: a local engine needs Ollama (and a GPU for "gpu"); then the chosen model.
  const local = state.engine === "gpu" || state.engine === "cpu";
  if (local && (live.ollama === "missing" || live.ollama === "offline")) {
    state = { ...state, engine: null, model: null, modelReady: false };
    clearTest();
    invalid.push({ step: "engine", reason: "setup.resume.reason.ollama" });
  } else if (state.engine === "gpu" && live.hasGpu === false) {
    state = { ...state, engine: null, model: null, modelReady: false };
    clearTest();
    invalid.push({ step: "engine", reason: "setup.resume.reason.gpu" });
  } else if (local && state.model !== null && live.installed !== null) {
    if (live.installed.includes(state.model)) {
      state = { ...state, modelReady: true };
    } else {
      state = { ...state, model: null, modelReady: false };
      clearTest();
      invalid.push({ step: "model", reason: "setup.resume.reason.model" });
    }
  }

  // Cloud: the active profile must still be the chosen provider, with its key stored.
  if (state.engine === "cloud" && state.cloud && live.activeCloud !== undefined) {
    const active = live.activeCloud;
    if (!active || !active.keySet || active.preset !== state.cloud.preset) {
      state = { ...state, cloud: null };
      clearTest();
      invalid.push({ step: "apiKey", reason: "setup.resume.reason.cloudKey" });
    }
  }

  // Voice: Piper picked (saved or live) but the PC voice is gone.
  const piperChosen = answers.voice_kind === "piper" || live.ttsLocalOnly === true;
  if (piperChosen && live.piperAvailable === false) {
    state = { ...state, voice: "unknown" };
    invalid.push({ step: "voice", reason: "setup.resume.reason.piper" });
  }

  // Avatar: 3D needs at least one VRM, and the selected one still on disk.
  if (state.personalize && answers.avatar === "3d" && live.vrm) {
    const { files, selected } = live.vrm;
    if (files.length === 0 || (selected !== null && !files.includes(selected))) {
      invalid.push({ step: "avatar", reason: "setup.resume.reason.avatar" });
    }
  }

  const path = stepPath(state.engine, state.personalize, state.localVoice, state.ollamaMissing);
  const savedStep = normalizeSavedStep(raw.step);
  const target =
    savedStep && path.includes(savedStep)
      ? savedStep
      : savedStep === "fallback" && path.includes("test")
        ? "test"
        : nearestBlockStart(state);
  const targetIndex = path.indexOf(target);
  // Never past a screen that still needs an answer.
  const incompleteIndex = path.findIndex((step, i) => i < targetIndex && !canAdvance({ ...state, step }));
  const firstInvalid = invalid
    .map((entry) => ({ ...entry, index: path.indexOf(entry.step) }))
    .filter((entry) => entry.index >= 0 && entry.index <= targetIndex)
    .sort((a, b) => a.index - b.index)[0];

  let landIndex = targetIndex;
  if (incompleteIndex >= 0) landIndex = Math.min(landIndex, incompleteIndex);
  if (firstInvalid) landIndex = Math.min(landIndex, firstInvalid.index);

  // Say why only when that problem is the screen we land on; a renamed step gets its own line.
  const reason: ResumeReason | null =
    firstInvalid && path[landIndex] === firstInvalid.step ? firstInvalid.reason : savedStep ? null : "setup.resume.reason.step";

  return {
    state: { ...state, step: path[landIndex] ?? "language" },
    reason,
    language: answers.language,
    hearKira: answers.hear_kira,
    avatar: answers.avatar
  };
}

// ─── `/setup <section>` ─────────────────────────────────────────────────────

/** es + en words a user may type after /setup. Accents are stripped before the lookup. */
const SECTION_ALIASES: Readonly<Record<string, SetupStep>> = {
  idioma: "language",
  language: "language",
  voz: "voice",
  voice: "voice",
  cerebro: "engine",
  brain: "engine",
  engine: "engine",
  motor: "engine",
  avatar: "avatar",
  perfil: "profile",
  profile: "profile",
  busqueda: "search",
  search: "search",
  tema: "theme",
  theme: "theme",
  liveaudio: "liveaudio"
};

/** The section words, in help-text order. */
export const SETUP_SECTION_WORDS = Object.keys(SECTION_ALIASES);

export type SetupSection = { kind: "step"; step: SetupStep } | { kind: "unknown" };

export function parseSetupSection(raw: string): SetupSection | null {
  const word = raw.trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  if (!word) return null;
  const step = SECTION_ALIASES[word];
  return step ? { kind: "step", step } : { kind: "unknown" };
}

/**
 * The words typed after `/setup`, handed from the command launcher to the
 * setup screen (the launcher only passes a command id). Read once: a later
 * plain `/setup` never reuses an old section.
 */
let pendingSection = "";

export function stashSetupSection(raw: string): void {
  pendingSection = raw;
}

export function takeSetupSection(): SetupSection | null {
  const raw = pendingSection;
  pendingSection = "";
  return parseSetupSection(raw);
}
