import { beforeEach, describe, expect, it, vi } from "vitest";
import { NARRATOR_MUTED_KEY, readNarratorMuted, writeNarratorMuted } from "./narratorPref.js";

describe("narrator mute preference", () => {
  beforeEach(() => window.localStorage.clear());

  it("defaults to unmuted and round-trips through localStorage", () => {
    expect(readNarratorMuted()).toBe(false);
    writeNarratorMuted(true);
    expect(window.localStorage.getItem(NARRATOR_MUTED_KEY)).toBe("1");
    expect(readNarratorMuted()).toBe(true);
    writeNarratorMuted(false);
    expect(readNarratorMuted()).toBe(false);
  });

  it("degrades to unmuted when storage throws", () => {
    const get = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("denied");
    });
    const set = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("denied");
    });
    expect(readNarratorMuted()).toBe(false);
    expect(() => writeNarratorMuted(true)).not.toThrow();
    get.mockRestore();
    set.mockRestore();
  });
});
