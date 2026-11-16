import { describe, expect, it } from "vitest";
import { parseVisionCommand } from "./visionCommand.js";

describe("parseVisionCommand", () => {
  it.each(["/mira", "!mira", "/look", "!look", "/MIRA", "!Look"])("matches a bare %s", (text) => {
    expect(parseVisionCommand(text)).toEqual({ rest: "" });
  });

  it("returns the remainder after the command word", () => {
    expect(parseVisionCommand("/mira  que ves aqui?")).toEqual({ rest: "que ves aqui?" });
    expect(parseVisionCommand("!look what is this")).toEqual({ rest: "what is this" });
  });

  it("tolerates surrounding whitespace", () => {
    expect(parseVisionCommand("  /look  ")).toEqual({ rest: "" });
  });

  it("does not match longer words or plain text", () => {
    expect(parseVisionCommand("/miraculo")).toBeNull();
    expect(parseVisionCommand("/looking")).toBeNull();
    expect(parseVisionCommand("mira esto")).toBeNull();
    expect(parseVisionCommand("hey /mira")).toBeNull();
    expect(parseVisionCommand("/model")).toBeNull();
  });

  it("reads an optional clip or text mode word right after the command", () => {
    expect(parseVisionCommand("/mira clip")).toEqual({ rest: "", mode: "clip" });
    expect(parseVisionCommand("/mira video que pasa aqui")).toEqual({ rest: "que pasa aqui", mode: "clip" });
    expect(parseVisionCommand("!look clip what happens")).toEqual({ rest: "what happens", mode: "clip" });
    expect(parseVisionCommand("/mira texto")).toEqual({ rest: "", mode: "text" });
    expect(parseVisionCommand("/look text what does it say")).toEqual({ rest: "what does it say", mode: "text" });
    expect(parseVisionCommand("/mira lee esto")).toEqual({ rest: "esto", mode: "text" });
  });

  it("keeps the default mode when the first word is not a mode word", () => {
    expect(parseVisionCommand("/mira clipboard")).toEqual({ rest: "clipboard" });
    expect(parseVisionCommand("/mira que ves")).toEqual({ rest: "que ves" });
  });
});
