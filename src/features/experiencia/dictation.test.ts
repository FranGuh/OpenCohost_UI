import { describe, expect, it } from "vitest";
import { insertDictation } from "./dictation.js";

describe("insertDictation (ptt-dictation-20261111)", () => {
  it("fills an empty composer with the text alone and puts the caret at its end", () => {
    expect(insertDictation("", "hola Kira", null)).toEqual({ value: "hola Kira", caret: 9 });
  });

  it("appends with one separating space when the composer never had focus", () => {
    expect(insertDictation("ya escrito", "y dictado", null)).toEqual({ value: "ya escrito y dictado", caret: 20 });
  });

  it("does not double the space when the existing text already ends with one", () => {
    expect(insertDictation("ya escrito ", "y dictado", null)).toEqual({ value: "ya escrito y dictado", caret: 20 });
  });

  it("replaces the selected text", () => {
    // "hola MUNDO cruel" with "MUNDO" selected (5..10).
    const out = insertDictation("hola MUNDO cruel", "gente", { start: 5, end: 10 });
    expect(out).toEqual({ value: "hola gente cruel", caret: 10 });
  });

  it("inserts at the caret with spaces on both sides when it lands inside words", () => {
    const out = insertDictation("holamundo", "querido", { start: 4, end: 4 });
    expect(out.value).toBe("hola querido mundo");
    expect(out.value.slice(0, out.caret)).toBe("hola querido");
  });

  it("adds no space before trailing punctuation", () => {
    const out = insertDictation("hola, ¿cómo estás?", "Kira", { start: 4, end: 4 });
    expect(out.value).toBe("hola Kira, ¿cómo estás?");
    expect(out.caret).toBe(9);
  });

  it("inserts at the very start without a leading space", () => {
    expect(insertDictation("mundo", "hola", { start: 0, end: 0 })).toEqual({ value: "hola mundo", caret: 4 });
  });

  it("clamps a selection that outgrew the current text (it changed since it was captured)", () => {
    expect(insertDictation("abc", "de verdad", { start: 10, end: 20 })).toEqual({ value: "abc de verdad", caret: 13 });
  });

  it("normalizes a reversed selection", () => {
    expect(insertDictation("uno dos tres", "DOS", { start: 7, end: 4 }).value).toBe("uno DOS tres");
  });

  it("trims the dictated text before inserting", () => {
    expect(insertDictation("", "  hola Kira  ", null)).toEqual({ value: "hola Kira", caret: 9 });
  });
});
