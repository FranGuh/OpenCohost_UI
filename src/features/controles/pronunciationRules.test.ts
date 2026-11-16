import { describe, expect, it } from "vitest";
import { validatePronunciationRows } from "./pronunciationRules.js";

const LIMITS = { max_entries: 200, match_max: 64, replace_max: 128 };
const row = (match: string, replace: string, id = match) => ({ id, match, replace });

describe("validatePronunciationRows", () => {
  it("accepts a valid list and an empty replace (silences the word)", () => {
    expect(validatePronunciationRows([row("OBS", "o be ese"), row("um", "")], LIMITS)).toEqual({});
  });

  it("flags an empty or whitespace-only match", () => {
    expect(validatePronunciationRows([row("  ", "x", "a")], LIMITS)).toEqual({ a: { match: "empty" } });
  });

  it("flags a match over match_max and a replace over replace_max", () => {
    const out = validatePronunciationRows([row("m".repeat(65), "r".repeat(129), "a")], LIMITS);
    expect(out).toEqual({ a: { match: "too_long", replace: "too_long" } });
  });

  it("accepts values exactly at the limits", () => {
    expect(validatePronunciationRows([row("m".repeat(64), "r".repeat(128))], LIMITS)).toEqual({});
  });

  it.each([".", "!", "?", "…", "\n", "<", ">", "*"])("rejects forbidden char %j in replace", (ch) => {
    expect(validatePronunciationRows([row("a", `x${ch}y`, "r")], LIMITS)).toEqual({ r: { replace: "forbidden_char" } });
  });

  it("flags case-insensitive trimmed duplicates on the later row", () => {
    const out = validatePronunciationRows([row("OBS", "a", "1"), row(" obs ", "b", "2")], LIMITS);
    expect(out).toEqual({ "2": { match: "duplicate" } });
  });

  it("reports empty matches as empty, not duplicate", () => {
    const out = validatePronunciationRows([row("", "a", "1"), row("", "b", "2")], LIMITS);
    expect(out).toEqual({ "1": { match: "empty" }, "2": { match: "empty" } });
  });
});
