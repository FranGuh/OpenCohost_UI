import { describe, expect, it } from "vitest";
import { modelsEn } from "./models.en.js";
import { modelsEs } from "./models.es.js";

describe("models i18n bundle", () => {
  it("has the same non-empty keys in en and es", () => {
    expect(Object.keys(modelsEn).sort()).toEqual(Object.keys(modelsEs).sort());
    for (const [key, value] of Object.entries(modelsEs)) {
      expect(value, key).not.toBe("");
      expect(modelsEn[key as keyof typeof modelsEs], key).not.toBe("");
    }
  });

  it("covers every backend error_category and HF error detail", () => {
    for (const category of ["network", "not_found", "rejected", "disk_full", "pull_error", "internal"]) {
      expect(Object.keys(modelsEs)).toContain(`models.download.error.${category}`);
    }
    for (const detail of ["invalid_hf_repo", "hf_repo_not_found", "hf_unavailable"]) {
      expect(Object.keys(modelsEs)).toContain(`models.hf.error.${detail}`);
    }
  });
});
