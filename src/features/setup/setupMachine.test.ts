import { describe, expect, it } from "vitest";
import { setupEn } from "../../i18n/bundles/setup.en.js";
import { setupEs } from "../../i18n/bundles/setup.es.js";
import {
  CPU_RECOMMENDED_MODEL,
  canAdvance,
  initialSetupState,
  modelGroups,
  narrationFor,
  pickDefaultModel,
  reduceSetup,
  resumedSetupState,
  stepPath,
  stepProgress,
  type TestErrorCode,
  type SetupEvent,
  type SetupMachineState
} from "./setupMachine.js";

function run(events: SetupEvent[], from: SetupMachineState = initialSetupState()): SetupMachineState {
  return events.reduce(reduceSetup, from);
}

describe("setup step path", () => {
  it("places voice/speed/test after narrator and before welcome, then routes local vs cloud", () => {
    const head = ["language", "kiraLanguage", "narrator", "voice", "voiceSpeed", "voiceTest", "welcome", "hardware", "engine"];
    const tail = ["test", "personalize", "done"];
    expect(stepPath(null)).toEqual([...head, "model", ...tail]);
    expect(stepPath("gpu")).toEqual([...head, "model", ...tail]);
    expect(stepPath("cpu")).toEqual([...head, "model", ...tail]);
    expect(stepPath("cloud")).toEqual([...head, "apiKey", "fallback", ...tail]);
  });

  it("adds the personalize screens only after the user said yes", () => {
    const base = ["language", "kiraLanguage", "narrator", "voice", "voiceSpeed", "voiceTest", "welcome", "hardware", "engine", "model", "test", "personalize"];
    expect(stepPath("cpu", null)).toEqual([...base, "done"]);
    expect(stepPath("cpu", false)).toEqual([...base, "done"]);
    expect(stepPath("cpu", true)).toEqual([...base, "avatar", "profile", "search", "liveaudio", "theme", "done"]);
  });

  it("omits fallback from the cloud path when Ollama is missing, and keeps it otherwise", () => {
    const head = ["language", "kiraLanguage", "narrator", "voice", "voiceSpeed", "voiceTest", "welcome", "hardware", "engine"];
    const tail = ["test", "personalize", "done"];
    expect(stepPath("cloud", null, false, false)).toEqual([...head, "apiKey", "fallback", ...tail]);
    expect(stepPath("cloud", null, false, true)).toEqual([...head, "apiKey", ...tail]);
  });
});

describe("early voice block without duplicate voiceChoice", () => {
  it("never includes voiceChoice even when Piper is chosen, and shares the voice counter entry", () => {
    expect(stepPath("cpu", null, true)).not.toContain("voiceChoice");
    expect(stepPath("cpu", null, false)).not.toContain("voiceChoice");
    expect(stepPath("cpu", null, true).slice(2, 7)).toEqual(["narrator", "voice", "voiceSpeed", "voiceTest", "welcome"]);
    const state = { ...initialSetupState(), engine: "cpu" as const, localVoice: true };
    expect(stepProgress({ ...state, step: "voice" })).toEqual({ current: 2, total: 9 });
    expect(stepProgress({ ...state, step: "voiceSpeed" })).toEqual({ current: 2, total: 9 });
    expect(stepProgress({ ...state, step: "voiceTest" })).toEqual({ current: 2, total: 9 });
  });

  it("walks kind → speed → test directly for both Piper and Edge", () => {
    const atKind: SetupMachineState = { ...initialSetupState(), step: "voice", engine: "cpu" };
    const piper = reduceSetup(atKind, { type: "voiceKind", local: true });
    expect(piper.localVoice).toBe(true);
    const atSpeed = reduceSetup(piper, { type: "next" });
    expect(atSpeed.step).toBe("voiceSpeed");
    expect(reduceSetup(atSpeed, { type: "next" }).step).toBe("voiceTest");
    expect(reduceSetup(reduceSetup(atSpeed, { type: "back" }), { type: "back" }).step).toBe("narrator");
    const edge = reduceSetup(piper, { type: "voiceKind", local: false });
    expect(reduceSetup(edge, { type: "next" }).step).toBe("voiceSpeed");
    expect(reduceSetup(edge, { type: "voiceKind", local: false })).toBe(edge);
  });

  it("is walked by a Cambiar on voice, then returns straight to done", () => {
    const done: SetupMachineState = { ...initialSetupState(), step: "done", engine: "cpu", model: "m", modelReady: true, voice: "ok", testVerdict: "passed", personalize: false, localVoice: true };
    const kind = reduceSetup(done, { type: "edit", step: "voice" });
    const speed = reduceSetup(kind, { type: "next" });
    expect(speed.step).toBe("voiceSpeed");
    const test = reduceSetup(speed, { type: "next" });
    expect(test.step).toBe("voiceTest");
    expect(reduceSetup(test, { type: "next" }).step).toBe("done");
  });
});

describe("reduceSetup", () => {
  it("starts on the language step with nothing chosen", () => {
    const state = initialSetupState();
    expect(state.step).toBe("language");
    expect(state.engine).toBeNull();
    expect(state.voice).toBe("unknown");
  });

  it("walks language → kiraLanguage → narrator → voice → voiceSpeed → voiceTest → welcome → hardware → engine and refuses to leave engine without a choice", () => {
    const state = run([
      { type: "next" },
      { type: "next" },
      { type: "next" },
      { type: "next" },
      { type: "next" },
      { type: "voiceResult", heard: true },
      { type: "next" },
      { type: "next" },
      { type: "next" }
    ]);
    expect(state.step).toBe("engine");
    expect(canAdvance(state)).toBe(false);
    expect(reduceSetup(state, { type: "next" }).step).toBe("engine");
  });

  it("rejects the GPU engine when no GPU was detected", () => {
    const state = run([{ type: "hardware", hasGpu: false }, { type: "chooseEngine", engine: "gpu" }]);
    expect(state.engine).toBeNull();
  });

  it("drops a GPU choice when a later hardware report says there is no GPU", () => {
    const state = run([
      { type: "hardware", hasGpu: true },
      { type: "chooseEngine", engine: "gpu" },
      { type: "hardware", hasGpu: false }
    ]);
    expect(state.engine).toBeNull();
  });

  it("requires an installed model before leaving the model step", () => {
    let state = run([{ type: "chooseEngine", engine: "cpu" }, { type: "next" }], { ...initialSetupState(), step: "engine" });
    expect(state.step).toBe("model");
    state = reduceSetup(state, { type: "chooseModel", tag: "qwen3:1.7b", installed: false });
    expect(canAdvance(state)).toBe(false);
    state = reduceSetup(state, { type: "modelInstalled", tag: "qwen3:1.7b" });
    expect(canAdvance(state)).toBe(true);
    expect(reduceSetup(state, { type: "next" }).step).toBe("test");
  });

  it("ignores an install report for a model that is no longer selected", () => {
    const state = run([
      { type: "chooseModel", tag: "qwen3:4b", installed: false },
      { type: "chooseModel", tag: "qwen3:1.7b", installed: false },
      { type: "modelInstalled", tag: "qwen3:4b" }
    ]);
    expect(state.modelReady).toBe(false);
  });

  it("requires a validated key on the API key step and resets validation when the engine changes", () => {
    let state = run([{ type: "chooseEngine", engine: "cloud" }, { type: "next" }], { ...initialSetupState(), step: "engine" });
    expect(state.step).toBe("apiKey");
    expect(canAdvance(state)).toBe(false);
    state = reduceSetup(state, { type: "cloudValidated", preset: "openai", model: "gpt-4o-mini" });
    expect(canAdvance(state)).toBe(true);
    expect(state.cloud).toEqual({ preset: "openai", model: "gpt-4o-mini" });
    state = reduceSetup(state, { type: "back" });
    state = reduceSetup(state, { type: "chooseEngine", engine: "cpu" });
    expect(state.cloud).toBeNull();
  });

  it("walks voice kind → speed → test line, and only the last needs an answer; either answer advances to welcome", () => {
    const atKind: SetupMachineState = { ...initialSetupState(), step: "voice" };
    expect(canAdvance(atKind)).toBe(true);
    const atSpeed = reduceSetup(atKind, { type: "next" });
    expect(atSpeed.step).toBe("voiceSpeed");
    expect(canAdvance(atSpeed)).toBe(true);
    const atVoice = reduceSetup(atSpeed, { type: "next" });
    expect(atVoice.step).toBe("voiceTest");
    expect(canAdvance(atVoice)).toBe(false);
    expect(reduceSetup(reduceSetup(atVoice, { type: "voiceResult", heard: false }), { type: "next" }).step).toBe("welcome");
    expect(reduceSetup(atVoice, { type: "voiceResult", heard: true }).voice).toBe("ok");
  });

  it("needs a finished inference test (any verdict) before the personalize question", () => {
    const atTest: SetupMachineState = { ...initialSetupState(), step: "test", engine: "cpu", voice: "ok" };
    expect(canAdvance(atTest)).toBe(false);
    const tested = reduceSetup(atTest, { type: "testFinished", verdict: "failed" });
    expect(canAdvance(tested)).toBe(true);
    expect(reduceSetup(tested, { type: "next" }).step).toBe("personalize");
  });

  it("needs a yes/no on personalizing; no goes straight to done, yes opens the avatar screen", () => {
    const atAsk: SetupMachineState = { ...initialSetupState(), step: "personalize", engine: "cpu" };
    expect(initialSetupState().personalize).toBeNull();
    expect(canAdvance(atAsk)).toBe(false);
    const no = reduceSetup(atAsk, { type: "personalize", wants: false });
    expect(no).toMatchObject({ step: "done", personalize: false });
    const yes = reduceSetup(atAsk, { type: "personalize", wants: true });
    expect(yes).toMatchObject({ step: "avatar", personalize: true });
    expect(canAdvance(yes)).toBe(true);
    const profile = reduceSetup(yes, { type: "next" });
    expect(profile.step).toBe("profile");
    const search = reduceSetup(profile, { type: "next" });
    expect(search.step).toBe("search");
    const liveaudio = reduceSetup(search, { type: "next" });
    expect(liveaudio.step).toBe("liveaudio");
    const theme = reduceSetup(liveaudio, { type: "next" });
    expect(theme.step).toBe("theme");
    expect(reduceSetup(theme, { type: "next" }).step).toBe("done");
    expect(reduceSetup(yes, { type: "back" }).step).toBe("personalize");
  });

  it("goes back from done to the personalize question when it was skipped", () => {
    const done: SetupMachineState = { ...initialSetupState(), step: "done", engine: "cpu", personalize: false };
    expect(reduceSetup(done, { type: "back" }).step).toBe("personalize");
  });

  it("goes back along the path of the chosen engine and never before language", () => {
    const atTest: SetupMachineState = { ...initialSetupState(), step: "test", engine: "cloud" };
    expect(reduceSetup(atTest, { type: "back" }).step).toBe("fallback");
    expect(reduceSetup({ ...atTest, step: "fallback" }, { type: "back" }).step).toBe("apiKey");
    expect(reduceSetup({ ...initialSetupState(), step: "welcome" }, { type: "back" }).step).toBe("voiceTest");
    expect(reduceSetup({ ...initialSetupState(), step: "voice" }, { type: "back" }).step).toBe("narrator");
    expect(reduceSetup(initialSetupState(), { type: "back" }).step).toBe("language");
  });

  it("skips fallback between apiKey and test in both directions when Ollama is missing", () => {
    const atKey = run([
      { type: "ollama", missing: true },
      { type: "chooseEngine", engine: "cloud" },
      { type: "cloudValidated", preset: "openai", model: "gpt-4o-mini" }
    ], { ...initialSetupState(), step: "apiKey" });
    const atTest = reduceSetup(atKey, { type: "next" });
    expect(atTest.step).toBe("test");
    expect(reduceSetup(atTest, { type: "back" }).step).toBe("apiKey");

    // If Ollama turns missing while the user is already on fallback, next/back still recover cleanly.
    const onFallback = reduceSetup({ ...atKey, step: "fallback" }, { type: "ollama", missing: true });
    expect(reduceSetup(onFallback, { type: "next" }).step).toBe("test");
    expect(reduceSetup(onFallback, { type: "back" }).step).toBe("apiKey");
  });
});

describe("modelGroups", () => {
  const catalog = {
    "qwen3:1.7b": { display: "Qwen 3 (1.7B)", desc: "", size_gb: 1.4, family: "qwen3", min_vram_gb: 0 },
    "qwen3:4b": { display: "Qwen 3 (4B)", desc: "", size_gb: 2.5, family: "qwen3", min_vram_gb: 4 },
    llama3: { display: "LLaMA 3", desc: "", size_gb: 4.7, family: "llama", min_vram_gb: 6 },
    "gemma4:e4b": { display: "Gemma 4", desc: "", size_gb: 9.6, family: "gemma", min_vram_gb: 10 }
  };

  it("lists every installed model, in the catalog or not, fitting or not, recommended first", () => {
    const groups = modelGroups(catalog, {
      engine: "gpu",
      vramGb: 8,
      recommended: "llama3",
      installed: ["my-custom:7b", "gemma4:e4b", "llama3", "qwen3:1.7b"]
    });
    expect(groups.installed.map((m) => m.tag)).toEqual(["llama3", "qwen3:1.7b", "gemma4:e4b", "my-custom:7b"]);
    expect(groups.installed.every((m) => m.installed)).toBe(true);
    expect(groups.installed[0].recommended).toBe(true);
    const custom = groups.installed.find((m) => m.tag === "my-custom:7b");
    expect(custom).toMatchObject({ display: "my-custom:7b", sizeGb: null, inCatalog: false, fits: true });
    expect(groups.installed.find((m) => m.tag === "gemma4:e4b")?.fits).toBe(false);
  });

  it("offers for download only catalog models that fit and are not installed", () => {
    const groups = modelGroups(catalog, { engine: "gpu", vramGb: 8, recommended: "llama3", installed: ["qwen3:1.7b"] });
    expect(groups.downloadable.map((m) => m.tag)).toEqual(["llama3", "qwen3:4b"]);
    expect(groups.downloadable.every((m) => !m.installed)).toBe(true);
  });

  it("on CPU downloads only light models, recommends qwen3:1.7b and flags the slower ones", () => {
    const groups = modelGroups(catalog, { engine: "cpu", vramGb: 0, recommended: "llama3", installed: [] });
    expect(groups.installed).toEqual([]);
    expect(groups.downloadable.map((m) => m.tag)).toEqual([CPU_RECOMMENDED_MODEL, "qwen3:4b"]);
    expect(groups.downloadable[0].recommended).toBe(true);
    expect(groups.downloadable[1].slowOnCpu).toBe(true);
  });

  it("treats a catalog entry without min_vram_gb (older backend) as CPU-capable", () => {
    const groups = modelGroups({ x: { display: "X", desc: "", size_gb: 1, family: "f" } }, { engine: "cpu", vramGb: 0, recommended: null, installed: [] });
    expect(groups.downloadable.map((m) => m.tag)).toEqual(["x"]);
  });
});

describe("pickDefaultModel", () => {
  const catalog = {
    "qwen3:1.7b": { display: "Qwen 3 (1.7B)", desc: "", size_gb: 1.4, family: "qwen3", min_vram_gb: 0 },
    llama3: { display: "LLaMA 3", desc: "", size_gb: 4.7, family: "llama", min_vram_gb: 6 }
  };
  const input = { engine: "gpu" as const, vramGb: 8, recommended: "llama3" };

  it("prefers the recommended model when it is installed", () => {
    expect(pickDefaultModel(modelGroups(catalog, { ...input, installed: ["qwen3:1.7b", "llama3"] }))).toEqual({ tag: "llama3", installed: true });
  });

  it("prefers any installed model over downloading the recommendation", () => {
    expect(pickDefaultModel(modelGroups(catalog, { ...input, installed: ["mine:1b"] }))).toEqual({ tag: "mine:1b", installed: true });
  });

  it("falls back to the recommended download when nothing is installed", () => {
    expect(pickDefaultModel(modelGroups(catalog, { ...input, installed: [] }))).toEqual({ tag: "llama3", installed: false });
    expect(pickDefaultModel({ installed: [], downloadable: [] })).toBeNull();
  });
});

describe("editing from the done step", () => {
  const done: SetupMachineState = {
    ...initialSetupState(),
    step: "done",
    hasGpu: true,
    engine: "gpu",
    model: "llama3",
    modelReady: true,
    voice: "ok",
    testVerdict: "passed",
    personalize: false
  };

  it("jumps to the chosen step and returns straight to done on Continue", () => {
    const voice = reduceSetup(done, { type: "edit", step: "voice" });
    expect(voice.step).toBe("voice");
    expect(voice.returnToDone).toBe(true);
    // The three voice screens are walked in order, then Continue lands back on done.
    const atSpeed = reduceSetup(voice, { type: "next" });
    expect(atSpeed.step).toBe("voiceSpeed");
    const atTest = reduceSetup(atSpeed, { type: "next" });
    expect(atTest.step).toBe("voiceTest");
    const back = reduceSetup(reduceSetup(atTest, { type: "voiceResult", heard: false }), { type: "next" });
    expect(back.step).toBe("done");
    expect(back.returnToDone).toBe(false);
    expect(back.voice).toBe("off");
  });

  it("goes through only the steps the edit invalidated", () => {
    // A new model resets the speed test: Continue skips the voice step and lands on the test.
    let state = reduceSetup(done, { type: "edit", step: "model" });
    state = reduceSetup(state, { type: "chooseModel", tag: "qwen3:1.7b", installed: true });
    state = reduceSetup(state, { type: "next" });
    expect(state.step).toBe("test");
    state = reduceSetup(reduceSetup(state, { type: "testFinished", verdict: "passed" }), { type: "next" });
    expect(state.step).toBe("done");
  });

  it("a new engine goes back through the model step", () => {
    let state = reduceSetup(done, { type: "edit", step: "engine" });
    state = reduceSetup(state, { type: "chooseEngine", engine: "cpu" });
    state = reduceSetup(state, { type: "next" });
    expect(state.step).toBe("model");
  });

  it("an edit with no change returns to done on the first Continue", () => {
    const state = reduceSetup(reduceSetup(done, { type: "edit", step: "engine" }), { type: "next" });
    expect(state.step).toBe("done");
  });

  it("ignores an edit to a step that is not on the current path", () => {
    expect(reduceSetup(done, { type: "edit", step: "apiKey" })).toBe(done);
  });

  it("walks language → kiraLanguage and returns to done on a language jump", () => {
    const atLang = reduceSetup(done, { type: "jump", step: "language" });
    expect(atLang.step).toBe("language");
    const atKiraLang = reduceSetup(atLang, { type: "next" });
    expect(atKiraLang.step).toBe("kiraLanguage");
    expect(reduceSetup(atKiraLang, { type: "next" }).step).toBe("done");
  });
});

describe("narrationFor", () => {
  it("picks a fixed line per step, with hardware facts interpolated on the hardware step", () => {
    expect(narrationFor(initialSetupState(), null).key).toBe("setup.kira.language");
    expect(narrationFor({ ...initialSetupState(), step: "kiraLanguage" as SetupMachineState["step"] }, null).key).toBe("setup.kira.kiraLanguage");
    expect(narrationFor({ ...initialSetupState(), step: "welcome" }, null).key).toBe("setup.kira.welcome");
    expect(narrationFor({ ...initialSetupState(), step: "personalize" }, null).key).toBe("setup.kira.personalize");
    expect(narrationFor({ ...initialSetupState(), step: "avatar" }, null).key).toBe("setup.kira.avatar");
    expect(narrationFor({ ...initialSetupState(), step: "profile" }, null).key).toBe("setup.kira.profile");
    expect(narrationFor({ ...initialSetupState(), step: "narrator" }, null).key).toBe("setup.kira.narrator");
    expect(narrationFor({ ...initialSetupState(), step: "voice" }, null).key).toBe("setup.kira.voice");
    expect(narrationFor({ ...initialSetupState(), step: "voiceSpeed" }, null).key).toBe("setup.kira.voiceSpeed");
    expect(narrationFor({ ...initialSetupState(), step: "voiceTest" }, null).key).toBe("setup.kira.voiceTest");
    expect(narrationFor({ ...initialSetupState(), step: "fallback" }, null).key).toBe("setup.kira.fallback");
    expect(narrationFor({ ...initialSetupState(), step: "search" }, null).key).toBe("setup.kira.search");
    expect(narrationFor({ ...initialSetupState(), step: "liveaudio" }, null).key).toBe("setup.kira.liveaudio");
    expect(narrationFor({ ...initialSetupState(), step: "theme" }, null).key).toBe("setup.kira.theme");
    const hw = { ...initialSetupState(), step: "hardware" as const };
    expect(narrationFor(hw, { hasGpu: false, gpuName: null, vramGb: 0 }).key).toBe("setup.kira.hardware.noGpu");
    expect(narrationFor(hw, { hasGpu: true, gpuName: "RTX 3060", vramGb: 12 })).toEqual({
      key: "setup.kira.hardware.bigGpu",
      vars: { gpu: "RTX 3060", vram: 12 }
    });
    expect(narrationFor(hw, { hasGpu: true, gpuName: "GTX 1660", vramGb: 6 }).key).toBe("setup.kira.hardware.smallGpu");
    expect(narrationFor(hw, null).key).toBe("setup.kira.hardware.checking");
  });

  it("uses the API key line on the cloud branch", () => {
    expect(narrationFor({ ...initialSetupState(), step: "apiKey", engine: "cloud" }, null).key).toBe("setup.kira.apiKey");
  });

  it("speaks the speed test verdict with formatted numbers once a result exists", () => {
    const atTest: SetupMachineState = { ...initialSetupState(), step: "test", engine: "gpu" };
    expect(narrationFor(atTest, null).key).toBe("setup.kira.test");
    const passed = reduceSetup(atTest, { type: "testFinished", verdict: "passed", firstTokenMs: 412, tokensPerSecond: 69.3, errorCode: null });
    expect(narrationFor(passed, null)).toEqual({ key: "setup.kira.test.passed", vars: { first: "0.4" } });
    const slow = reduceSetup(atTest, { type: "testFinished", verdict: "slow", firstTokenMs: 2900, tokensPerSecond: 7.25, errorCode: null });
    expect(narrationFor(slow, null)).toEqual({ key: "setup.kira.test.slow", vars: { first: "2.9" } });
  });

  it("omits null metrics from the verdict line instead of saying zero", () => {
    const atTest: SetupMachineState = { ...initialSetupState(), step: "test", engine: "gpu" };
    const finish = (firstTokenMs: number | null, tokensPerSecond: number | null) =>
      narrationFor(reduceSetup(atTest, { type: "testFinished", verdict: "passed", firstTokenMs, tokensPerSecond, errorCode: null }), null);
    expect(finish(null, 50)).toEqual({ key: "setup.kira.test.passed.tpsOnly", vars: {} });
    expect(finish(800, null)).toEqual({ key: "setup.kira.test.passed.firstOnly", vars: { first: "0.8" } });
    expect(finish(null, null)).toEqual({ key: "setup.kira.test.passed.none", vars: {} });
  });

  it("names the failure reason when the test failed", () => {
    const atTest: SetupMachineState = { ...initialSetupState(), step: "test", engine: "gpu" };
    const failed = (errorCode: "timeout" | null) =>
      narrationFor(reduceSetup(atTest, { type: "testFinished", verdict: "failed", firstTokenMs: null, tokensPerSecond: null, errorCode }), null).key;
    expect(failed("timeout")).toBe("setup.kira.test.failed.timeout");
    expect(failed(null)).toBe("setup.kira.test.failed");
  });

  it("reads a summary line on the done step, with or without voice", () => {
    const done: SetupMachineState = { ...initialSetupState(), step: "done", engine: "gpu", voice: "ok" };
    const extras = { engineName: "Local con GPU", modelName: "Gemma 4" };
    expect(narrationFor(done, null, extras)).toEqual({ key: "setup.kira.done.voiceOn", vars: { engine: "Local con GPU", model: "Gemma 4" } });
    expect(narrationFor({ ...done, voice: "off" }, null, extras).key).toBe("setup.kira.done.textMode");
  });
});

describe("review fixes (S8)", () => {
  const ERROR_CODES: TestErrorCode[] = [
    "ollama_unreachable", "model_missing", "timeout", "cloud_auth", "cloud_rate_limit", "cloud_bad_request", "cloud_error", "busy"
  ];

  it.each(ERROR_CODES)("has a narration line in both languages for the %s failure", (errorCode) => {
    const atTest: SetupMachineState = { ...initialSetupState(), step: "test", engine: "cloud" };
    const failed = reduceSetup(atTest, { type: "testFinished", verdict: "failed", errorCode });
    const { key } = narrationFor(failed, null);
    expect(setupEs[key as keyof typeof setupEs]).toBeTruthy();
    expect(setupEn[key as keyof typeof setupEn]).toBeTruthy();
  });

  it("counts the personalize block as one step so the total never jumps", () => {
    const atPersonalize: SetupMachineState = { ...initialSetupState(), step: "personalize", engine: "cpu" };
    const before = stepProgress(atPersonalize);
    const atAvatar = reduceSetup(atPersonalize, { type: "personalize", wants: true });
    expect(atAvatar.step).toBe("avatar");
    expect(stepProgress(atAvatar)).toEqual(before);
    for (const step of ["profile", "search", "liveaudio", "theme"] as const) {
      expect(stepProgress({ ...atAvatar, step })).toEqual(before);
    }
    expect(stepProgress({ ...atAvatar, step: "done" })).toEqual({ current: before.total, total: before.total });
  });

  it("re-opens a completed setup on the summary and lets one part change without redoing the rest", () => {
    const resumed = resumedSetupState({ engine: "gpu", hasGpu: true, model: "qwen3:4b", cloud: null });
    expect(resumed.step).toBe("done");
    const atVoice = reduceSetup(resumed, { type: "edit", step: "voice" });
    expect(atVoice.step).toBe("voice");
    const back = run([{ type: "next" }, { type: "next" }, { type: "voiceResult", heard: true }, { type: "next" }], atVoice);
    expect(back.step).toBe("done");
  });

  it("counts the language block, the three early voice screens and the cloud fallback as one step each", () => {
    const at = (step: SetupMachineState["step"], engine: SetupMachineState["engine"] = "cloud"): SetupMachineState => ({ ...initialSetupState(), step, engine });
    expect(stepProgress(at("language"))).toEqual({ current: 1, total: 9 });
    expect(stepProgress(at("kiraLanguage"))).toEqual({ current: 1, total: 9 });
    expect(stepProgress(at("narrator"))).toEqual({ current: 1, total: 9 });
    const voice = stepProgress(at("voice"));
    expect(voice).toEqual({ current: 2, total: 9 });
    expect(stepProgress(at("voiceSpeed"))).toEqual(voice);
    expect(stepProgress(at("voiceTest"))).toEqual(voice);
    expect(stepProgress(at("welcome"))).toEqual({ current: 3, total: 9 });
    expect(stepProgress(at("hardware"))).toEqual({ current: 4, total: 9 });
    expect(stepProgress(at("engine"))).toEqual({ current: 5, total: 9 });
    expect(stepProgress(at("apiKey"))).toEqual({ current: 6, total: 9 });
    expect(stepProgress(at("apiKey"))).toEqual(stepProgress(at("fallback")));
    expect(stepProgress(at("test"))).toEqual({ current: 7, total: 9 });
  });

  it("still asks for a new speed test after the engine changes on a re-opened setup", () => {
    const resumed = resumedSetupState({ engine: "cloud", hasGpu: false, model: null, cloud: { preset: "openai", model: "gpt" } });
    const atKey = run([{ type: "edit", step: "apiKey" }, { type: "cloudValidated", preset: "openai", model: "gpt-2" }, { type: "next" }], resumed);
    // The optional local fallback screen is not an invalidated step: Continue goes straight to the new speed test.
    expect(atKey.step).toBe("test");
  });
});
