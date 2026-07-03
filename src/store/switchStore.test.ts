import { beforeEach, describe, expect, it } from "vitest";
import { useSwitchStore } from "./switchStore.js";

describe("switchStore state-split guard (spec R8)", () => {
  beforeEach(() => {
    useSwitchStore.setState({ pendingSwitch: null });
  });

  it("initial store keys are a subset of {pendingSwitch}", () => {
    const state = useSwitchStore.getState();
    const dataKeys = Object.keys(state).filter((key) => typeof state[key as keyof typeof state] !== "function");
    expect(dataKeys).toEqual(["pendingSwitch"]);
  });

  it("never holds server-truth fields (active_profile/is_ready/health/current_model)", () => {
    useSwitchStore.getState().setPending({ name: "Akira", commandId: "cmd-1", status: "applying" });
    const state = useSwitchStore.getState();
    const serialized = JSON.stringify(state.pendingSwitch);
    expect(serialized).not.toMatch(/active_profile|is_ready|health|current_model/);
  });

  it("setPending sets the pending switch", () => {
    useSwitchStore.getState().setPending({ name: "Akira", commandId: "cmd-1", status: "applying" });
    expect(useSwitchStore.getState().pendingSwitch).toEqual({
      name: "Akira",
      commandId: "cmd-1",
      status: "applying"
    });
  });

  it("clearPending resets to null", () => {
    useSwitchStore.getState().setPending({ name: "Akira", commandId: "cmd-1", status: "applying" });
    useSwitchStore.getState().clearPending();
    expect(useSwitchStore.getState().pendingSwitch).toBeNull();
  });
});
