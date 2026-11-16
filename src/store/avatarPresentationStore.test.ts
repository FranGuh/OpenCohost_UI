import { beforeEach, describe, expect, it } from "vitest";
import {
  useAvatarPresentationStore,
  type AvatarPresentationMode
} from "./avatarPresentationStore.js";

const STORAGE_KEY = "oc-avatar-presentation";

describe("avatarPresentationStore", () => {
  beforeEach(() => {
    window.localStorage.clear();
    useAvatarPresentationStore.setState({ mode: "2d", selectedModel: "" });
  });

  it("defaults to 2d mode and empty selectedModel", () => {
    const state = useAvatarPresentationStore.getState();
    expect(state.mode).toBe("2d");
    expect(state.selectedModel).toBe("");
  });

  it("updates mode and persists to localStorage", () => {
    useAvatarPresentationStore.getState().setMode("3d");
    expect(useAvatarPresentationStore.getState().mode).toBe("3d");

    const raw = window.localStorage.getItem(STORAGE_KEY);
    expect(raw).toBeTruthy();
    const parsed = JSON.parse(raw!);
    expect(parsed.mode).toBe("3d");
  });

  it("updates selectedModel and persists to localStorage", () => {
    useAvatarPresentationStore.getState().setSelectedModel("kira-3d.vrm");
    expect(useAvatarPresentationStore.getState().selectedModel).toBe("kira-3d.vrm");

    const raw = window.localStorage.getItem(STORAGE_KEY);
    expect(raw).toBeTruthy();
    const parsed = JSON.parse(raw!);
    expect(parsed.selectedModel).toBe("kira-3d.vrm");
  });

  it("switches between 2d and 3d seamlessly", () => {
    useAvatarPresentationStore.getState().setMode("3d");
    expect(useAvatarPresentationStore.getState().mode).toBe("3d");

    useAvatarPresentationStore.getState().setMode("2d");
    expect(useAvatarPresentationStore.getState().mode).toBe("2d");

    const parsed = JSON.parse(window.localStorage.getItem(STORAGE_KEY)!);
    expect(parsed.mode).toBe("2d");
  });
});
