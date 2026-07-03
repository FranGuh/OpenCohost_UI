import { create } from "zustand";

export const THEME_NAMES = ["cockpit", "aurora", "studio"] as const;
export type ThemeName = (typeof THEME_NAMES)[number];

const STORAGE_KEY = "oc-theme";
const DEFAULT_THEME: ThemeName = "cockpit";

function isThemeName(value: string | null): value is ThemeName {
  return value !== null && (THEME_NAMES as readonly string[]).includes(value);
}

function readStoredTheme(): ThemeName {
  const stored = window.localStorage.getItem(STORAGE_KEY);
  return isThemeName(stored) ? stored : DEFAULT_THEME;
}

function applyTheme(theme: ThemeName) {
  document.documentElement.dataset.theme = theme;
  window.localStorage.setItem(STORAGE_KEY, theme);
}

interface ThemeStoreState {
  theme: ThemeName;
  setTheme(next: ThemeName): void;
  /**
   * Test-only: this store is a module singleton (by design — F4 fixes the
   * per-component useState desync by giving every consumer ONE shared
   * source). Tests that manipulate localStorage directly need to re-run the
   * read/validate logic instead of re-importing the module. Not used by app
   * code — index.html's blocking script + this store's own init already
   * cover the real startup path.
   */
  _hydrateForTests(): void;
}

// index.html carries a blocking pre-paint script that already applies the
// persisted theme (same key/set/default) before any module runs; this keeps
// the store's own state consistent with the DOM for any render path that
// doesn't go through that script (e.g. tests, Storybook).
const initialTheme = readStoredTheme();
document.documentElement.dataset.theme = initialTheme;

export const useThemeStore = create<ThemeStoreState>((set) => ({
  theme: initialTheme,
  setTheme: (next) => {
    applyTheme(next);
    set({ theme: next });
  },
  _hydrateForTests: () => {
    const theme = readStoredTheme();
    document.documentElement.dataset.theme = theme;
    set({ theme });
  }
}));

/**
 * Runtime theme switch (decision #2827, hardened by F4): backed by the
 * single shared `useThemeStore` above, so every consumer reads/writes the
 * same theme value instead of desyncing per-component `useState` instances.
 * Sets `data-theme` on `document.documentElement` (tokens.css re-skins from
 * there) and persists the choice to localStorage so it restores on the next
 * load.
 */
export function useTheme() {
  const theme = useThemeStore((state) => state.theme);
  const setTheme = useThemeStore((state) => state.setTheme);
  return { theme, setTheme };
}
