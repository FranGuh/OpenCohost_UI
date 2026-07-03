import { useCallback, useEffect, useState } from "react";

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

/**
 * Runtime theme switch (decision #2827): sets `data-theme` on
 * `document.documentElement` (tokens.css re-skins from there) and persists
 * the choice to localStorage so it restores on the next load.
 */
export function useTheme() {
  const [theme, setThemeState] = useState<ThemeName>(readStoredTheme);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    window.localStorage.setItem(STORAGE_KEY, theme);
  }, [theme]);

  const setTheme = useCallback((next: ThemeName) => setThemeState(next), []);

  return { theme, setTheme };
}
