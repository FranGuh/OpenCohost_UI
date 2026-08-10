import { beforeEach, describe, expect, it, vi } from "vitest";
import { t } from "./t.js";
import { useUiLocaleStore } from "./locale.js";
import { EN, ES, type TKey } from "./bundles.js";

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
    // No shipped key carries a placeholder yet (E0 only adds the two Idioma
    // row labels), so this seeds a throwaway entry to exercise the resolver's
    // regex directly — it is not real UI copy.
    const key = "shell.__t_test__.interp" as TKey;
    (ES as Record<string, string>)[key] = "Hola {name}, tenés {count} mensajes";
    (EN as Record<string, string>)[key] = "Hello {name}, you have {count} messages";

    expect(t(key, { name: "Kira" })).toBe("Hola Kira, tenés {count} mensajes");
    expect(t(key)).toBe("Hola {name}, tenés {count} mensajes");

    delete (ES as Record<string, string>)[key];
    delete (EN as Record<string, string>)[key];
  });

  it("keeps EN and ES structurally complete with each other", () => {
    expect(Object.keys(EN).length).toBe(Object.keys(ES).length);
  });
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
