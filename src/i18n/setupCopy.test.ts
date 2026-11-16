import { describe, expect, it } from "vitest";
import { setupEn } from "./bundles/setup.en.js";
import { setupEs } from "./bundles/setup.es.js";

describe("setup copy for non-technical users", () => {
  it("never mentions tokens in either language", () => {
    const offenders = [...Object.entries(setupEs), ...Object.entries(setupEn)].filter(([, value]) =>
      /\btokens?\b|tok\/s/i.test(value)
    );
    expect(offenders).toEqual([]);
  });

  it("keeps key parity between es and en", () => {
    expect(Object.keys(setupEn).sort()).toEqual(Object.keys(setupEs).sort());
  });

  it("uses plain words for the step chips and keys (jargon pass)", () => {
    expect(setupEs["setup.step.engine"]).toBe("Cerebro de Kira");
    expect(setupEn["setup.step.engine"]).toBe("Kira's brain");
    expect(setupEs["setup.step.hardware"]).toBe("Tu PC");
    expect(setupEn["setup.step.hardware"]).toBe("Your PC");
    expect(setupEs["setup.test.metric.load"]).toBe("Preparación");
    const all = [...Object.values(setupEs), ...Object.values(setupEn)];
    expect(all.filter((value) => /backend/i.test(value))).toEqual([]);
    expect(Object.values(setupEs).filter((value) => /\b(llave|clave)\b/i.test(value))).toEqual([]);
    expect(Object.keys(setupEs)).not.toContain("setup.hardware.badge.missing");
    expect(setupEs["setup.language.kiraPending"]).not.toMatch(/voz/i);
    expect(setupEn["setup.language.kiraPending"]).not.toMatch(/voice/i);
  });
});
