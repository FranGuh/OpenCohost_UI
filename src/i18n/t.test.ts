import { beforeEach, describe, expect, it, vi } from "vitest";
import { t } from "./t.js";
import { useUiLocaleStore } from "./locale.js";

beforeEach(() => {
  window.localStorage.clear();
  useUiLocaleStore.setState({ locale: "es" });
});

describe("t()", () => {
  it("round-trips a key in both locales", () => {
    expect(t("shell.settings.language.interface")).toBe("Interfaz");
    useUiLocaleStore.getState().setLocale("en");
    expect(t("shell.settings.language.interface")).toBe("Interface");
  });

  it("substitutes {name} interpolation and leaves a missing variable's placeholder intact", () => {
    // Real shipped interpolated keys — 66 of them carry a {placeholder} today,
    // agenda.constraints.max among them — so this asserts the resolver
    // against actual bundle content instead of mutating the live ES/EN
    // dictionaries to seed a throwaway key.
    expect(t("agenda.constraints.max", { n: 5 })).toBe("Máximo 5 etiquetas.");
    expect(t("agenda.constraints.max")).toBe("Máximo {n} etiquetas.");

    useUiLocaleStore.getState().setLocale("en");
    expect(t("agenda.constraints.max", { n: 5 })).toBe("5 tags maximum.");
    expect(t("agenda.constraints.max")).toBe("{n} tags maximum.");
  });

  // No "EN/ES key count" case here, deliberately: bundles.ts's
  // `EN: Record<keyof typeof ES, string>` annotation already makes a
  // dropped-or-extra EN key a hard `tsc` failure (TS2739/TS2741 for missing,
  // TS2353 for extra — verified by deliberately breaking a bundle, §8.2 of
  // the migration doc). A runtime `Object.keys(...).length` comparison is
  // strictly weaker than that compile-time check (it can't even tell a
  // dropped key from a stray added one apart), so it was deleted rather than
  // upgraded to a sorted-array comparison — it would still only be a slower,
  // redundant copy of a guarantee the type system already gives for free.
});

describe("locale.ts storage safety (§7)", () => {
  it("falls back to the default locale instead of throwing when localStorage.getItem throws", async () => {
    vi.spyOn(window.localStorage, "getItem").mockImplementation(() => {
      throw new Error("storage denied");
    });
    vi.resetModules();

    const fresh = await import("./locale.js");

    expect(fresh.useUiLocaleStore.getState().locale).toBe("es");

    vi.restoreAllMocks();
    vi.resetModules();
  });

  it("does not throw when localStorage.setItem is denied on setLocale", async () => {
    vi.resetModules();
    const fresh = await import("./locale.js");
    vi.spyOn(window.localStorage, "setItem").mockImplementation(() => {
      throw new Error("storage denied");
    });

    expect(() => fresh.useUiLocaleStore.getState().setLocale("en")).not.toThrow();
    expect(fresh.useUiLocaleStore.getState().locale).toBe("en");

    vi.restoreAllMocks();
    vi.resetModules();
  });
});
