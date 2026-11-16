import { beforeEach, describe, expect, it } from "vitest";
import { STAGE_ZOOM_STORAGE_KEY, useStageControlsStore } from "./stageControlsStore.js";

beforeEach(() => {
  window.localStorage.clear();
  useStageControlsStore.setState({ framingMode: "half", qaRunning: false, qaIndex: 0, stage3dMounted: false });
});

describe("stageControlsStore", () => {
  it("setFramingMode updates the mode and persists it", () => {
    useStageControlsStore.getState().setFramingMode("head");
    expect(useStageControlsStore.getState().framingMode).toBe("head");
    expect(window.localStorage.getItem(STAGE_ZOOM_STORAGE_KEY)).toBe("head");
  });

  it("startQa restarts from the first animation and stopQa halts the run", () => {
    useStageControlsStore.setState({ qaIndex: 5 });
    useStageControlsStore.getState().startQa();
    expect(useStageControlsStore.getState()).toMatchObject({ qaRunning: true, qaIndex: 0 });
    useStageControlsStore.getState().stopQa();
    expect(useStageControlsStore.getState().qaRunning).toBe(false);
  });
});
