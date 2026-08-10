import { Button } from "../ui/Button.js";
import { useT } from "../i18n/t.js";
import { THEME_NAMES, useTheme } from "./useTheme.js";
import type { ThemeName } from "./useTheme.js";

const THEME_LABELS: Record<ThemeName, string> = {
  cockpit: "Cockpit",
  aurora: "Aurora",
  studio: "Studio"
};

/** Segmented control — owner-requested live theme testing (decision #2827). */
export function ThemeSwitcher() {
  const { theme, setTheme } = useTheme();
  const t = useT();

  return (
    <div role="group" aria-label={t("shell.settings.theme.eyebrow")} className="inline-flex gap-[3px] rounded-full border border-border bg-card p-1 shadow-soft">
      {THEME_NAMES.map((name) => (
        <Button
          key={name}
          type="button"
          variant={theme === name ? "primary" : "ghost"}
          aria-pressed={theme === name}
          onClick={() => setTheme(name)}
          className="h-8 rounded-full px-4 text-[13px]"
        >
          {THEME_LABELS[name]}
        </Button>
      ))}
    </div>
  );
}
