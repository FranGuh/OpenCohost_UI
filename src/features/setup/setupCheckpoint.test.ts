import { describe, expect, it } from "vitest";
import type { SetupCheckpoint } from "../../api/setup.js";
import { initialSetupState, reduceSetup, resumedSetupState, type SetupMachineState } from "./setupMachine.js";
import {
  CHECKPOINT_VERSION,
  checkpointResumeStep,
  parseSetupSection,
  restoreCheckpoint,
  toCheckpoint,
  type LiveFacts
} from "./setupCheckpoint.js";

const LIVE: LiveFacts = {
  hasGpu: false,
  ollama: "ready",
  installed: ["qwen3:1.7b"],
  activeCloud: null,
  piperAvailable: true,
  ttsLocalOnly: false,
  vrm: null
};

function cp(step: string, answers: Record<string, unknown> = {}): SetupCheckpoint {
  return { version: CHECKPOINT_VERSION, step, answers, updated_at: "2026-11-12T10:00:00+00:00" } as unknown as SetupCheckpoint;
}

const LOCAL_DONE = {
  engine: "cpu",
  model: "qwen3:1.7b",
  model_ready: true,
  voice: "ok",
  test_verdict: "passed"
};

describe("toCheckpoint", () => {
  it("captures the step and only non-secret answers", () => {
    const state: SetupMachineState = {
      ...initialSetupState(),
      step: "voice",
      engine: "cloud",
      cloud: { preset: "gemini", model: "gemini-2.5-flash" },
      voice: "ok",
      personalize: true
    };
    const out = toCheckpoint(state, { language: "en", hearKira: false, voiceKind: "edge", avatar: "2d" });
    expect(out).toEqual({
      version: 1,
      step: "voice",
      answers: {
        language: "en",
        hear_kira: false,
        engine: "cloud",
        model: null,
        model_ready: false,
        cloud_preset: "gemini",
        cloud_model: "gemini-2.5-flash",
        voice: "ok",
        voice_kind: "edge",
        test_verdict: null,
        personalize: true,
        avatar: "2d"
      }
    });
    expect(JSON.stringify(out)).not.toMatch(/key/i);
  });
});

describe("restoreCheckpoint — legacy voiceChoice checkpoint", () => {
  it("normalizes an old voiceChoice checkpoint cleanly onto voiceSpeed without error", () => {
    const { state, reason } = restoreCheckpoint(cp("voiceChoice", { ...LOCAL_DONE, voice_kind: "piper" }), LIVE);
    expect(state.step).toBe("voiceSpeed");
    expect(reason).toBeNull();
    expect(checkpointResumeStep(cp("voiceChoice", { ...LOCAL_DONE, voice_kind: "piper" }))).toBe("voiceSpeed");
  });

  it("drops back to voice when Piper is unavailable even from a legacy voiceChoice checkpoint", () => {
    const { state, reason } = restoreCheckpoint(cp("voiceChoice", { ...LOCAL_DONE, voice_kind: "piper" }), { ...LIVE, piperAvailable: false });
    expect(state.step).toBe("voice");
    expect(reason).toBe("setup.resume.reason.piper");
  });
});

describe("restoreCheckpoint — happy path", () => {
  it("lands on the saved step with the saved answers", () => {
    const { state, reason } = restoreCheckpoint(cp("voiceTest", LOCAL_DONE), LIVE);
    expect(reason).toBeNull();
    expect(state.step).toBe("voiceTest");
    expect(state.engine).toBe("cpu");
    expect(state.model).toBe("qwen3:1.7b");
    expect(state.modelReady).toBe(true);
    expect(state.voice).toBe("ok");
    expect(state.returnToDone).toBe(false);
  });

  it("restores the personalize block", () => {
    const { state } = restoreCheckpoint(cp("search", { ...LOCAL_DONE, personalize: true }), LIVE);
    expect(state.step).toBe("search");
    expect(state.personalize).toBe(true);
  });

  it("never lands past an unanswered screen", () => {
    // Saved on the speed test, but the voice test was never answered.
    const { state, reason } = restoreCheckpoint(cp("test", { ...LOCAL_DONE, voice: "unknown" }), LIVE);
    expect(state.step).toBe("voiceTest");
    expect(reason).toBeNull();
  });

  it("resumes cleanly on kiraLanguage and on narrator after a Kira language restart", () => {
    const atKiraLang = restoreCheckpoint(cp("kiraLanguage", { language: "en" }), LIVE);
    expect(atKiraLang.state.step).toBe("kiraLanguage");
    expect(atKiraLang.language).toBe("en");
    expect(atKiraLang.reason).toBeNull();

    const atNarrator = restoreCheckpoint(cp("narrator", { language: "en", engine: "cpu" }), LIVE);
    expect(atNarrator.state.step).toBe("narrator");
    expect(atNarrator.state.engine).toBe("cpu");
    expect(atNarrator.language).toBe("en");
    expect(atNarrator.reason).toBeNull();
  });
});

describe("restoreCheckpoint — validation against live state", () => {
  it("unknown or renamed step id goes to the nearest block start", () => {
    const { state, reason } = restoreCheckpoint(cp("brainz", { engine: "cpu", voice: "ok" }), LIVE);
    expect(state.step).toBe("model");
    expect(reason).toBe("setup.resume.reason.step");
  });

  it("unknown step with nothing answered goes to the earliest unanswered block (voice)", () => {
    expect(restoreCheckpoint(cp("oldStep"), LIVE).state.step).toBe("voice");
  });

  it.each(["missing", "offline"] as const)("local engine with Ollama %s drops to the engine screen", (ollama) => {
    const { state, reason } = restoreCheckpoint(cp("test", LOCAL_DONE), { ...LIVE, ollama });
    expect(state.step).toBe("engine");
    expect(state.engine).toBeNull();
    expect(state.model).toBeNull();
    expect(state.testVerdict).toBeNull();
    expect(reason).toBe("setup.resume.reason.ollama");
  });

  it("Ollama unknown (probe failed) keeps the local answers", () => {
    expect(restoreCheckpoint(cp("test", LOCAL_DONE), { ...LIVE, ollama: "unknown" }).state.step).toBe("test");
  });

  it("gpu engine without a GPU now drops to the engine screen", () => {
    const { state, reason } = restoreCheckpoint(cp("test", { ...LOCAL_DONE, engine: "gpu" }), { ...LIVE, hasGpu: false });
    expect(state.step).toBe("engine");
    expect(reason).toBe("setup.resume.reason.gpu");
  });

  it("chosen model no longer installed drops to the model screen", () => {
    const { state, reason } = restoreCheckpoint(cp("personalize", LOCAL_DONE), { ...LIVE, installed: ["llama3"] });
    expect(state.step).toBe("model");
    expect(state.engine).toBe("cpu");
    expect(state.model).toBeNull();
    expect(state.modelReady).toBe(false);
    expect(state.testVerdict).toBeNull();
    expect(reason).toBe("setup.resume.reason.model");
  });

  it("a model that was still downloading lands on the model screen without a reason", () => {
    const { state, reason } = restoreCheckpoint(cp("test", { ...LOCAL_DONE, model_ready: false }), { ...LIVE, installed: [] });
    expect(state.step).toBe("model");
    expect(reason).toBe("setup.resume.reason.model");
  });

  const CLOUD = { engine: "cloud", cloud_preset: "gemini", cloud_model: "g-flash", voice: "ok" };

  it("cloud answers survive when the active profile still has its key", () => {
    const live = { ...LIVE, activeCloud: { preset: "gemini", keySet: true } };
    const { state } = restoreCheckpoint(cp("test", CLOUD), live);
    expect(state.step).toBe("test");
    expect(state.cloud).toEqual({ preset: "gemini", model: "g-flash" });
  });

  it.each([
    ["no active cloud profile", null],
    ["key gone", { preset: "gemini", keySet: false }],
    ["other provider", { preset: "openai", keySet: true }]
  ])("cloud with %s drops to the provider screen", (_label, activeCloud) => {
    const { state, reason } = restoreCheckpoint(cp("test", CLOUD), { ...LIVE, activeCloud });
    expect(state.step).toBe("apiKey");
    expect(state.cloud).toBeNull();
    expect(reason).toBe("setup.resume.reason.cloudKey");
  });

  it("cloud provider unknown (read failed) keeps the cloud answers", () => {
    expect(restoreCheckpoint(cp("test", CLOUD), { ...LIVE, activeCloud: undefined }).state.step).toBe("test");
  });

  it("skips fallback on resume when Ollama is missing, and keeps it when ready, offline, or unknown", () => {
    const liveCloud = { preset: "gemini", keySet: true };
    const missingTest = restoreCheckpoint(cp("test", CLOUD), { ...LIVE, ollama: "missing", activeCloud: liveCloud });
    expect(missingTest.state.step).toBe("test");
    expect(reduceSetup(missingTest.state, { type: "back" }).step).toBe("apiKey");

    const missingFallback = restoreCheckpoint(cp("fallback", CLOUD), { ...LIVE, ollama: "missing", activeCloud: liveCloud });
    expect(missingFallback.state.step).toBe("test");
    expect(missingFallback.reason).toBeNull();

    for (const ollama of ["ready", "offline", "unknown"] as const) {
      const kept = restoreCheckpoint(cp("fallback", CLOUD), { ...LIVE, ollama, activeCloud: liveCloud });
      expect(kept.state.step).toBe("fallback");
    }
  });

  it("Piper chosen but no longer available drops to the voice screen", () => {
    const answers = { ...LOCAL_DONE, voice_kind: "piper" };
    const { state, reason } = restoreCheckpoint(cp("personalize", answers), { ...LIVE, piperAvailable: false });
    expect(state.step).toBe("voice");
    expect(state.voice).toBe("unknown");
    expect(reason).toBe("setup.resume.reason.piper");
  });

  it("live Piper setting counts as chosen too", () => {
    const live = { ...LIVE, piperAvailable: false, ttsLocalOnly: true };
    expect(restoreCheckpoint(cp("personalize", LOCAL_DONE), live).state.step).toBe("voice");
  });

  it("3D avatar with an empty VRM list drops to the avatar screen", () => {
    const answers = { ...LOCAL_DONE, personalize: true, avatar: "3d" };
    const { state, reason } = restoreCheckpoint(cp("theme", answers), { ...LIVE, vrm: { files: [], selected: null } });
    expect(state.step).toBe("avatar");
    expect(reason).toBe("setup.resume.reason.avatar");
  });

  it("3D avatar whose chosen file is gone drops to the avatar screen", () => {
    const answers = { ...LOCAL_DONE, personalize: true, avatar: "3d" };
    const live = { ...LIVE, vrm: { files: ["kira_v3.vrm"], selected: "mine.vrm" } };
    expect(restoreCheckpoint(cp("theme", answers), live).state.step).toBe("avatar");
  });

  it("3D avatar with its file present is kept", () => {
    const answers = { ...LOCAL_DONE, personalize: true, avatar: "3d" };
    const live = { ...LIVE, vrm: { files: ["kira_v3.vrm"], selected: "kira_v3.vrm" } };
    expect(restoreCheckpoint(cp("theme", answers), live).state.step).toBe("theme");
  });

  it("reports the earliest problem first", () => {
    const answers = { ...LOCAL_DONE, voice_kind: "piper" };
    const { state, reason } = restoreCheckpoint(cp("personalize", answers), { ...LIVE, ollama: "missing", piperAvailable: false });
    expect(state.step).toBe("voice");
    expect(reason).toBe("setup.resume.reason.piper");
  });
});

describe("restoreCheckpoint — odd input never crashes", () => {
  it.each([
    ["null answers", null],
    ["string answers", "oops"],
    ["array answers", [1, 2]],
    ["wrong types", { engine: 3, model: {}, voice: "loud", personalize: "yes", cloud_preset: 9 }]
  ])("%s", (_label, answers) => {
    const odd = { version: 1, step: "test", answers, updated_at: "" } as unknown as SetupCheckpoint;
    const { state } = restoreCheckpoint(odd, LIVE);
    expect(state.engine).toBeNull();
    expect(state.step).toBe("voiceTest");
  });

  it("a missing step falls back to a block start", () => {
    const odd = { version: 1, answers: {} } as unknown as SetupCheckpoint;
    expect(restoreCheckpoint(odd, LIVE).state.step).toBe("voice");
  });
});

describe("checkpointResumeStep", () => {
  it("returns the saved step when known, else the nearest block start", () => {
    expect(checkpointResumeStep(cp("voiceSpeed", LOCAL_DONE))).toBe("voiceSpeed");
    expect(checkpointResumeStep(cp("nope", { engine: "cloud", voice: "ok" }))).toBe("apiKey");
    expect(checkpointResumeStep(cp("nope", { engine: "cloud" }))).toBe("voice");
  });
});

describe("parseSetupSection", () => {
  it.each([
    ["idioma", "language"],
    ["Language", "language"],
    ["voz", "voice"],
    ["voice", "voice"],
    ["cerebro", "engine"],
    ["brain", "engine"],
    ["engine", "engine"],
    ["avatar", "avatar"],
    ["perfil", "profile"],
    ["profile", "profile"],
    ["busqueda", "search"],
    ["búsqueda", "search"],
    ["search", "search"],
    ["tema", "theme"],
    ["theme", "theme"],
    ["liveaudio", "liveaudio"],
    ["  VOZ  ", "voice"]
  ])("%s -> %s", (raw, step) => {
    expect(parseSetupSection(raw)).toEqual({ kind: "step", step });
  });

  it("empty means no section; anything else is unknown", () => {
    expect(parseSetupSection("")).toBeNull();
    expect(parseSetupSection("   ")).toBeNull();
    expect(parseSetupSection("banana")).toEqual({ kind: "unknown" });
  });
});

describe("jump event (direct section entry)", () => {
  const done = resumedSetupState({ engine: "cpu", hasGpu: false, model: "qwen3:1.7b", cloud: null });

  it("opens the block and returns to the summary", () => {
    const opened = reduceSetup(done, { type: "jump", step: "voice" });
    expect(opened.step).toBe("voice");
    expect(opened.returnToDone).toBe(true);
    let s = reduceSetup(opened, { type: "next" });
    expect(s.step).toBe("voiceSpeed");
    s = reduceSetup(reduceSetup(s, { type: "next" }), { type: "voiceResult", heard: true });
    expect(s.step).toBe("voiceTest");
    expect(reduceSetup(s, { type: "next" }).step).toBe("done");
  });

  it("opens a personalize screen even when personalize was never answered", () => {
    const opened = reduceSetup(done, { type: "jump", step: "theme" });
    expect(opened.step).toBe("theme");
    expect(opened.personalize).toBe(true);
    expect(reduceSetup(opened, { type: "next" }).step).toBe("done");
  });

  it("is ignored outside the summary", () => {
    const s = initialSetupState();
    expect(reduceSetup(s, { type: "jump", step: "voice" })).toBe(s);
  });
});

describe("restore event", () => {
  it("replaces the machine state", () => {
    const target = { ...initialSetupState(), step: "voice" as const, engine: "cpu" as const };
    expect(reduceSetup(initialSetupState(), { type: "restore", state: target })).toBe(target);
  });
});
