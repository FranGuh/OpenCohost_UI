import type { TKey } from "../../i18n/t.js";

/**
 * Setup assistant step machine (setup-assistant-20261008 T3). Pure domain: no
 * DOM, no network, no React. SetupFlow feeds it events and renders whatever
 * step it lands on; every side effect (downloads, provider writes, speech)
 * lives in the components and reports back through an event.
 */
export type SetupStep =
  | "language" | "kiraLanguage" | "narrator" | "voice" | "voiceSpeed" | "voiceTest"
  | "welcome" | "hardware" | "engine" | "model" | "apiKey" | "fallback"
  | "test" | "personalize" | "avatar" | "profile" | "search" | "liveaudio" | "theme" | "done";

/** "gpu" and "cpu" both run on local Ollama; they only change model eligibility. */
export type EngineChoice = "gpu" | "cpu" | "cloud";

export type VoiceAnswer = "unknown" | "ok" | "off";

export type TestVerdict = "passed" | "slow" | "failed";

export type TestErrorCode =
  | "ollama_unreachable"
  | "model_missing"
  | "timeout"
  | "cloud_auth"
  | "cloud_rate_limit"
  | "cloud_bad_request"
  | "cloud_error"
  | "busy";

/** The numbers Kira reads back after the speed test; each is null when the backend did not measure it. */
export interface TestSummary {
  verdict: TestVerdict;
  firstTokenMs: number | null;
  tokensPerSecond: number | null;
  errorCode: TestErrorCode | null;
}

export interface SetupMachineState {
  step: SetupStep;
  hasGpu: boolean;
  /** True when Ollama is confirmed missing on this PC (omits cloud local-fallback step). */
  ollamaMissing: boolean;
  engine: EngineChoice | null;
  /** Local model tag the user picked. */
  model: string | null;
  /** The picked model is installed in Ollama (already, or after a download). */
  modelReady: boolean;
  /** Set only after the provider confirmed the key; the key itself never enters this state. */
  cloud: { preset: string; model: string } | null;
  voice: VoiceAnswer;
  /**
   * The local (Piper) voice is on, so the voice-choice screen is on the path.
   * False until the voice screen reports the real setting (Edge never shows it).
   */
  localVoice: boolean;
  testVerdict: TestVerdict | null;
  testSummary: TestSummary | null;
  /** Set by a "Cambiar" action on the done step: Continue skips every step that is still complete. */
  returnToDone: boolean;
  /** Answer to "do you want to personalize Kira now?"; null until asked. The extra screens exist only on yes. */
  personalize: boolean | null;
  /**
   * Steps treated as complete without an answer in this run: a re-opened,
   * already completed setup starts on done with these assumed, so "Cambiar"
   * on one part does not force the user through the others again.
   */
  assumed: SetupStep[];
}

export type SetupEvent =
  | { type: "next" }
  | { type: "back" }
  | { type: "hardware"; hasGpu: boolean }
  | { type: "ollama"; missing: boolean }
  | { type: "chooseEngine"; engine: EngineChoice }
  | { type: "chooseModel"; tag: string; installed: boolean }
  | { type: "modelInstalled"; tag: string }
  | { type: "cloudValidated"; preset: string; model: string }
  | { type: "cloudInvalidated" }
  | { type: "voiceKind"; local: boolean }
  | { type: "voiceResult"; heard: boolean }
  | {
      type: "testFinished";
      verdict: TestVerdict;
      firstTokenMs?: number | null;
      tokensPerSecond?: number | null;
      errorCode?: TestErrorCode | null;
    }
  | { type: "personalize"; wants: boolean }
  | { type: "edit"; step: SetupStep }
  /** `/setup <section>` from the summary: like edit, and it opens the personalize block when needed. */
  | { type: "jump"; step: SetupStep }
  /** Resume from a saved checkpoint (already validated against live state). */
  | { type: "restore"; state: SetupMachineState }
  | ({ type: "prefill" } & ResumeFacts);

/** What the current configuration says, used to prefill a re-opened, completed setup. */
export interface ResumeFacts {
  engine: EngineChoice | null;
  hasGpu: boolean;
  /** Active local model tag (local engines only). */
  model: string | null;
  cloud: { preset: string; model: string } | null;
}

export const CPU_RECOMMENDED_MODEL = "qwen3:1.7b";

/** On CPU, catalog entries above this VRAM floor are hidden (too slow to be usable). */
export const CPU_MAX_MIN_VRAM_GB = 4;

export function initialSetupState(): SetupMachineState {
  return {
    step: "language",
    hasGpu: false,
    ollamaMissing: false,
    engine: null,
    model: null,
    modelReady: false,
    cloud: null,
    voice: "unknown",
    localVoice: false,
    testVerdict: null,
    testSummary: null,
    returnToDone: false,
    personalize: null,
    assumed: []
  };
}

const RESUME_ASSUMED: SetupStep[] = ["voice", "voiceSpeed", "voiceTest", "test", "personalize"];

/** A re-opened, completed setup: starts on the summary, prefilled from the current configuration. */
export function resumedSetupState(facts: ResumeFacts): SetupMachineState {
  return applyFacts({ ...initialSetupState(), step: "done", assumed: RESUME_ASSUMED }, facts);
}

function applyFacts(state: SetupMachineState, facts: ResumeFacts): SetupMachineState {
  const engine = facts.engine === "gpu" && !facts.hasGpu ? "cpu" : facts.engine;
  return {
    ...state,
    hasGpu: facts.hasGpu,
    engine,
    model: engine === "cloud" ? null : facts.model,
    modelReady: engine !== "cloud" && facts.model !== null,
    cloud: engine === "cloud" ? facts.cloud : null
  };
}

/** The optional personalize screens, in order; they exist on the path only after the user said yes. */
export const PERSONALIZE_STEPS: SetupStep[] = ["avatar", "profile", "search", "liveaudio", "theme"];

/**
 * The voice screens: kind, speed, test line. Placed right after narrator
 * so the user configures & tests Kira's voice early. A "Cambiar" on voice walks all three.
 */
const VOICE_STEPS: SetupStep[] = ["voice", "voiceSpeed", "voiceTest"];

/**
 * Screens that share one counter entry with the screen that opens their block.
 * Every screen asks exactly one thing; the counter counts blocks, not screens.
 */
const STEP_GROUP: Partial<Record<SetupStep, SetupStep>> = {
  kiraLanguage: "language",
  narrator: "language",
  fallback: "apiKey",
  voiceSpeed: "voice",
  voiceTest: "voice",
  avatar: "personalize",
  profile: "personalize",
  search: "personalize",
  liveaudio: "personalize",
  theme: "personalize"
};

export function stepGroup(step: SetupStep): SetupStep {
  return STEP_GROUP[step] ?? step;
}

export function stepPath(
  engine: EngineChoice | null,
  personalize: boolean | null = null,
  _localVoice = false,
  ollamaMissing = false
): SetupStep[] {
  const cloudSteps = ollamaMissing ? (["apiKey"] as const) : (["apiKey", "fallback"] as const);
  return [
    "language", "kiraLanguage", "narrator", ...VOICE_STEPS, "welcome", "hardware", "engine",
    ...(engine === "cloud" ? cloudSteps : (["model"] as const)),
    "test", "personalize", ...(personalize ? PERSONALIZE_STEPS : []), "done"
  ];
}

export function stepIndex(state: SetupMachineState): number {
  return Math.max(0, stepPath(state.engine, state.personalize, state.localVoice, state.ollamaMissing).indexOf(state.step));
}

/** One entry per block (see STEP_GROUP): what the counter and the /setup chips count. */
export function progressSteps(engine: EngineChoice | null): SetupStep[] {
  return stepPath(engine, false).filter((step) => stepGroup(step) === step);
}

/**
 * The "Paso X de Y" counter. A block of screens (language pair, voice,
 * personalize) counts as one step, so the total never jumps when a block opens.
 */
export function stepProgress(state: SetupMachineState): { current: number; total: number } {
  const path = progressSteps(state.engine);
  return { current: Math.max(0, path.indexOf(stepGroup(state.step))) + 1, total: path.length };
}

export function canAdvance(state: SetupMachineState): boolean {
  switch (state.step) {
    case "language":
    case "kiraLanguage":
    case "narrator":
    case "welcome":
    case "hardware":
      return true;
    case "engine":
      return state.engine !== null;
    case "model":
      return state.model !== null && state.modelReady;
    case "apiKey":
      return state.cloud !== null;
    case "fallback":
    case "voice":
    case "voiceSpeed":
      return true;
    case "voiceTest":
      return state.voice !== "unknown";
    case "test":
      return state.testVerdict !== null;
    case "personalize":
      return state.personalize !== null;
    case "avatar":
    case "profile":
    case "search":
    case "liveaudio":
    case "theme":
      return true;
    case "done":
      return false;
  }
}

export function reduceSetup(state: SetupMachineState, event: SetupEvent): SetupMachineState {
  switch (event.type) {
    case "next": {
      if (!canAdvance(state)) return state;
      const path = stepPath(state.engine, state.personalize, state.localVoice, state.ollamaMissing);
      const currentIndex =
        state.step === "fallback" && !path.includes("fallback") ? path.indexOf("apiKey") : path.indexOf(state.step);
      const rest = path.slice(currentIndex + 1);
      // After a "Cambiar" edit, skip straight to the first step the edit left
      // incomplete (or back to done when nothing else needs attention).
      const walkVoice = VOICE_STEPS.includes(state.step) && VOICE_STEPS.includes(rest[0]);
      const walkLanguage = state.step === "language" && rest[0] === "kiraLanguage";
      const next = state.returnToDone && !walkVoice && !walkLanguage
        ? rest.find((step) => step === "done" || (!canAdvance({ ...state, step }) && !state.assumed.includes(step)))
        : rest[0];
      if (!next) return state;
      return { ...state, step: next, returnToDone: next === "done" ? false : state.returnToDone };
    }
    case "edit": {
      if (state.step !== "done" || event.step === "done" || !stepPath(state.engine, state.personalize, state.localVoice, state.ollamaMissing).includes(event.step)) return state;
      return { ...state, step: event.step, returnToDone: true };
    }
    case "jump": {
      if (state.step !== "done" || event.step === "done") return state;
      const personalize = PERSONALIZE_STEPS.includes(event.step) ? true : state.personalize;
      if (!stepPath(state.engine, personalize, state.localVoice, state.ollamaMissing).includes(event.step)) return state;
      return { ...state, personalize, step: event.step, returnToDone: true };
    }
    case "restore":
      return event.state;
    case "personalize":
      return { ...state, personalize: event.wants, step: event.wants ? PERSONALIZE_STEPS[0] : "done", returnToDone: false };
    case "prefill": {
      // Only while the re-opened summary is untouched: never overwrite an edit in progress.
      if (state.step !== "done" || state.assumed.length === 0) return state;
      const { type: _type, ...facts } = event;
      return applyFacts(state, facts);
    }
    case "back": {
      const path = stepPath(state.engine, state.personalize, state.localVoice, state.ollamaMissing);
      if (state.step === "fallback" && !path.includes("fallback")) return { ...state, step: "apiKey" };
      const index = path.indexOf(state.step);
      return index > 0 ? { ...state, step: path[index - 1] } : state;
    }
    case "hardware":
      return {
        ...state,
        hasGpu: event.hasGpu,
        engine: !event.hasGpu && state.engine === "gpu" ? null : state.engine
      };
    case "ollama":
      return event.missing === state.ollamaMissing ? state : { ...state, ollamaMissing: event.missing };
    case "chooseEngine": {
      if (event.engine === "gpu" && !state.hasGpu) return state;
      if (event.engine === state.engine) return state;
      // A different engine invalidates everything chosen downstream of it.
      return { ...state, engine: event.engine, ...NO_MODEL, cloud: null, ...noTest(state) };
    }
    case "chooseModel":
      if (event.tag === state.model && event.installed === state.modelReady) return state;
      return { ...state, model: event.tag, modelReady: event.installed, ...noTest(state) };
    case "modelInstalled":
      return event.tag === state.model ? { ...state, modelReady: true } : state;
    case "cloudValidated":
      return { ...state, cloud: { preset: event.preset, model: event.model }, ...noTest(state) };
    case "cloudInvalidated":
      return { ...state, cloud: null };
    case "voiceKind":
      return event.local === state.localVoice ? state : { ...state, localVoice: event.local };
    case "voiceResult":
      return { ...state, voice: event.heard ? "ok" : "off" };
    case "testFinished":
      return {
        ...state,
        testVerdict: event.verdict,
        testSummary: {
          verdict: event.verdict,
          firstTokenMs: event.firstTokenMs ?? null,
          tokensPerSecond: event.tokensPerSecond ?? null,
          errorCode: event.errorCode ?? null
        }
      };
  }
}

const NO_MODEL = { model: null, modelReady: false } as const;
/** A new engine or model invalidates the speed test, including an assumed one. */
function noTest(state: SetupMachineState) {
  return { testVerdict: null, testSummary: null, assumed: state.assumed.filter((step) => step !== "test") };
}

// ─── Model eligibility ──────────────────────────────────────────────────────

export interface CatalogEntryLike {
  display: string;
  desc: string;
  size_gb: number;
  family: string;
  /** Older backends omit it; treated as 0 (runs on CPU). */
  min_vram_gb?: number;
}

export interface EligibleModel {
  tag: string;
  /** Catalog display name, or the raw Ollama tag for a model outside the catalog. */
  display: string;
  desc: string;
  /** null for a model outside the catalog (its size is unknown here). */
  sizeGb: number | null;
  minVramGb: number;
  installed: boolean;
  recommended: boolean;
  slowOnCpu: boolean;
  inCatalog: boolean;
  /** False when a catalog model needs more VRAM than this machine has (installed models only). */
  fits: boolean;
}

export interface EligibilityInput {
  engine: "gpu" | "cpu";
  vramGb: number;
  /** Backend hardware recommendation (GPU path); the CPU path always recommends qwen3:1.7b. */
  recommended: string | null;
  installed: readonly string[];
}

export interface ModelGroups {
  /** Every model Ollama has, in the catalog or not, fitting or not: pick one to use. */
  installed: EligibleModel[];
  /** Catalog models that fit this machine and are not installed yet. */
  downloadable: EligibleModel[];
}

function fitsMachine(minVramGb: number, input: EligibilityInput): boolean {
  return input.engine === "cpu" ? minVramGb <= CPU_MAX_MIN_VRAM_GB : minVramGb <= input.vramGb;
}

/** Stable order: recommended first, then catalog models lightest first, then the rest by tag. */
function byPreference(a: EligibleModel, b: EligibleModel): number {
  return (
    Number(b.recommended) - Number(a.recommended) ||
    Number(b.inCatalog) - Number(a.inCatalog) ||
    a.minVramGb - b.minVramGb ||
    (a.inCatalog ? 0 : a.tag.localeCompare(b.tag))
  );
}

export function modelGroups(catalog: Record<string, CatalogEntryLike>, input: EligibilityInput): ModelGroups {
  const recommended = input.engine === "cpu" ? CPU_RECOMMENDED_MODEL : input.recommended;
  const installedTags = new Set(input.installed);

  const describe = (tag: string): EligibleModel => {
    const entry = catalog[tag];
    const minVramGb = entry?.min_vram_gb ?? 0;
    return {
      tag,
      display: entry?.display ?? tag,
      desc: entry?.desc ?? "",
      sizeGb: entry ? entry.size_gb : null,
      minVramGb,
      installed: installedTags.has(tag),
      recommended: tag === recommended,
      slowOnCpu: Boolean(entry) && input.engine === "cpu" && minVramGb > 0,
      inCatalog: Boolean(entry),
      fits: !entry || fitsMachine(minVramGb, input)
    };
  };

  const installed = Array.from(installedTags).map(describe).sort(byPreference);
  const downloadable = Object.keys(catalog)
    .filter((tag) => !installedTags.has(tag))
    .map(describe)
    .filter((model) => model.fits)
    .sort(byPreference);
  return { installed, downloadable };
}

/**
 * The model preselected on the model step: an installed one when possible
 * (the recommendation first), so a machine that already has models never
 * defaults to a download.
 */
export function pickDefaultModel(groups: ModelGroups): { tag: string; installed: boolean } | null {
  const pick =
    groups.installed.find((model) => model.recommended) ??
    groups.installed[0] ??
    groups.downloadable.find((model) => model.recommended) ??
    groups.downloadable[0];
  return pick ? { tag: pick.tag, installed: pick.installed } : null;
}

// ─── Kira's fixed narration ─────────────────────────────────────────────────

export interface HardwareFacts {
  hasGpu: boolean;
  gpuName: string | null;
  vramGb: number;
}

export interface Narration {
  key: TKey;
  vars?: Record<string, string | number>;
}

/** GPUs at or above this VRAM run every recommended model comfortably. */
const BIG_GPU_VRAM_GB = 8;

/** Display names the narration interpolates; the caller resolves them through i18n and the catalog. */
export interface NarrationExtras {
  recommendedName?: string | null;
  engineName?: string | null;
  modelName?: string | null;
}

/** 412 ms -> "0.4" (seconds, one decimal). */
function seconds(ms: number): string {
  return (ms / 1000).toFixed(1);
}

function measured(value: number | null): value is number {
  return value !== null && Number.isFinite(value);
}

/**
 * The verdict line Kira reads after the speed test. A metric the backend did
 * not measure is left out of the sentence, never read as zero.
 */
/** One line per failure code; a code without its line fails the type check instead of speaking an empty bubble. */
const FAILED_LINE: Record<TestErrorCode, TKey> = {
  ollama_unreachable: "setup.kira.test.failed.ollama_unreachable",
  model_missing: "setup.kira.test.failed.model_missing",
  timeout: "setup.kira.test.failed.timeout",
  cloud_auth: "setup.kira.test.failed.cloud_auth",
  cloud_rate_limit: "setup.kira.test.failed.cloud_rate_limit",
  cloud_bad_request: "setup.kira.test.failed.cloud_bad_request",
  cloud_error: "setup.kira.test.failed.cloud_error",
  busy: "setup.kira.test.failed.busy"
};

const VERDICT_LINE = {
  passed: {
    both: "setup.kira.test.passed",
    firstOnly: "setup.kira.test.passed.firstOnly",
    tpsOnly: "setup.kira.test.passed.tpsOnly",
    none: "setup.kira.test.passed.none"
  },
  slow: {
    both: "setup.kira.test.slow",
    firstOnly: "setup.kira.test.slow.firstOnly",
    tpsOnly: "setup.kira.test.slow.tpsOnly",
    none: "setup.kira.test.slow.none"
  }
} as const satisfies Record<"passed" | "slow", Record<string, TKey>>;

export function testNarration(summary: TestSummary): Narration {
  if (summary.verdict === "failed") {
    return { key: summary.errorCode ? FAILED_LINE[summary.errorCode] ?? "setup.kira.test.failed" : "setup.kira.test.failed" };
  }
  const lines = VERDICT_LINE[summary.verdict];
  const first = measured(summary.firstTokenMs) ? seconds(summary.firstTokenMs) : null;
  // Speed is read as "good"/"slow", never as a number: only its presence picks the line.
  const hasSpeed = measured(summary.tokensPerSecond);
  if (first !== null && hasSpeed) return { key: lines.both, vars: { first } };
  if (first !== null) return { key: lines.firstOnly, vars: { first } };
  if (hasSpeed) return { key: lines.tpsOnly, vars: {} };
  return { key: lines.none, vars: {} };
}

/**
 * The line Kira says on each step. Always a fixed bundle string (with facts
 * interpolated) — never model output, so it works with no engine installed.
 */
export function narrationFor(
  state: SetupMachineState,
  hardware: HardwareFacts | null,
  extras: NarrationExtras = {}
): Narration {
  switch (state.step) {
    case "language":
      return { key: "setup.kira.language" };
    case "kiraLanguage":
      return { key: "setup.kira.kiraLanguage" };
    case "narrator":
      return { key: "setup.kira.narrator" };
    case "welcome":
      return { key: "setup.kira.welcome" };
    case "hardware": {
      if (!hardware) return { key: "setup.kira.hardware.checking" };
      if (!hardware.hasGpu) return { key: "setup.kira.hardware.noGpu" };
      const vars = { gpu: hardware.gpuName ?? "GPU", vram: hardware.vramGb };
      return {
        key: hardware.vramGb >= BIG_GPU_VRAM_GB ? "setup.kira.hardware.bigGpu" : "setup.kira.hardware.smallGpu",
        vars
      };
    }
    case "engine":
      return { key: "setup.kira.engine" };
    case "model":
      return extras.recommendedName
        ? { key: "setup.kira.model", vars: { model: extras.recommendedName } }
        : { key: "setup.kira.model.generic" };
    case "apiKey":
      return { key: "setup.kira.apiKey" };
    case "fallback":
      return { key: "setup.kira.fallback" };
    case "voice":
      return { key: "setup.kira.voice" };
    case "voiceSpeed":
      return { key: "setup.kira.voiceSpeed" };
    case "voiceTest":
      return { key: "setup.kira.voiceTest" };
    case "test":
      return state.testSummary ? testNarration(state.testSummary) : { key: "setup.kira.test" };
    case "personalize":
      return { key: "setup.kira.personalize" };
    case "avatar":
      return { key: "setup.kira.avatar" };
    case "profile":
      return { key: "setup.kira.profile" };
    case "search":
      return { key: "setup.kira.search" };
    case "liveaudio":
      return { key: "setup.kira.liveaudio" };
    case "theme":
      return { key: "setup.kira.theme" };
    case "done":
      return {
        key: state.voice === "off" ? "setup.kira.done.textMode" : "setup.kira.done.voiceOn",
        vars: { engine: extras.engineName ?? "—", model: extras.modelName ?? "—" }
      };
  }
}
