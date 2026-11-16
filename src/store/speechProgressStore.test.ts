import { describe, it, expect, beforeEach } from "vitest";
import { useSpeechProgressStore } from "./speechProgressStore.js";

describe("speechProgressStore", () => {
  beforeEach(() => {
    useSpeechProgressStore.getState().reset();
  });

  it("initializes with speaking false and currentIdx null", () => {
    const state = useSpeechProgressStore.getState();
    expect(state.speaking).toBe(false);
    expect(state.currentIdx).toBe(null);
    expect(state.total).toBe(0);
  });

  it("updates progress when speaking and currentIdx change", () => {
    useSpeechProgressStore.getState().setProgress(true, 1, 4);
    const state = useSpeechProgressStore.getState();
    expect(state.speaking).toBe(true);
    expect(state.currentIdx).toBe(1);
    expect(state.total).toBe(4);
    expect(state.feedTurnId).toBe(null);

    useSpeechProgressStore.getState().setProgress(true, 2, 4, 42);
    expect(useSpeechProgressStore.getState().feedTurnId).toBe(42);
  });

  it("resets progress to idle state", () => {
    useSpeechProgressStore.getState().setProgress(true, 2, 4, 42);
    useSpeechProgressStore.getState().reset();
    const state = useSpeechProgressStore.getState();
    expect(state.speaking).toBe(false);
    expect(state.currentIdx).toBe(null);
    expect(state.total).toBe(0);
    expect(state.feedTurnId).toBe(null);
    expect(state.jobId).toBe(null);
    expect(state.fragment).toBe(null);
  });

  it("keeps the feed turn id, job id and spoken fragment", () => {
    useSpeechProgressStore.getState().setProgress(true, 1, 3, 7, { jobId: 5, fragment: "Hola mundo." });
    const state = useSpeechProgressStore.getState();
    expect(state.feedTurnId).toBe(7);
    expect(state.jobId).toBe(5);
    expect(state.fragment).toBe("Hola mundo.");
  });

  it("drops the previous job's fragment and index when the job id changes", () => {
    const { setProgress } = useSpeechProgressStore.getState();
    setProgress(true, 2, 3, 7, { jobId: 5, fragment: "Old fragment." });
    // New job reports no fragment yet: nothing from job 5 may linger.
    setProgress(true, null, 0, null, { jobId: 6, fragment: null });
    const state = useSpeechProgressStore.getState();
    expect(state.jobId).toBe(6);
    expect(state.fragment).toBe(null);
    expect(state.currentIdx).toBe(null);
    expect(state.feedTurnId).toBe(null);
  });

  it("bumps jobEpoch only when the job id changes", () => {
    const { setProgress } = useSpeechProgressStore.getState();
    setProgress(true, 0, 2, 7, { jobId: 5, fragment: "A." });
    const e1 = useSpeechProgressStore.getState().jobEpoch;
    setProgress(true, 1, 2, 7, { jobId: 5, fragment: "B." });
    expect(useSpeechProgressStore.getState().jobEpoch).toBe(e1);
    setProgress(true, 0, 2, 7, { jobId: 6, fragment: "A." });
    expect(useSpeechProgressStore.getState().jobEpoch).toBe(e1 + 1);
  });
});
