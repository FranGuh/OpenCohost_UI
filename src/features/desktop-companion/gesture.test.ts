import { describe, expect, it } from "vitest";
import { gestureKind } from "./gesture.js";

describe("gestureKind pure decision", () => {
  it("classifies small movements as click", () => {
    expect(gestureKind(0, 0, false)).toBe("click");
    expect(gestureKind(3, 2, false)).toBe("click");
    expect(gestureKind(-4, 4, false)).toBe("click");
  });

  it("classifies movements >= 6px as drag", () => {
    expect(gestureKind(6, 0, false)).toBe("drag");
    expect(gestureKind(0, -6, false)).toBe("drag");
    expect(gestureKind(5, 5, false)).toBe("drag");
  });

  it("classifies canceled pointers as cancel regardless of movement", () => {
    expect(gestureKind(0, 0, true)).toBe("cancel");
    expect(gestureKind(10, 20, true)).toBe("cancel");
  });
});
