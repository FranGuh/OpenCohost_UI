import { Button } from "../ui/Button.js";
import { useT } from "../i18n/t.js";
import { THEME_NAMES, useTheme } from "./useTheme.js";
import type { ThemeName } from "./useTheme.js";

const THEME_LABELS: Record<ThemeName, string> = {
  cockpit: "Cockpit",
  aurora: "Aurora",
  studio: "Studio",
  "kira-aurora": "Kira Aurora"
};

/** Segmented control — owner-requested live theme testing (decision #2827). */
export function ThemeSwitcher() {
  const { theme, setTheme } = useTheme();
  const t = useT();

  return (
    <div
      role="group"
      aria-label={t("shell.settings.theme.eyebrow")}
      className="grid grid-cols-2 gap-1 rounded-xl bg-surface-2/80 p-1"
    >
      {THEME_NAMES.map((name) => (
        <Button
          key={name}
          type="button"
          variant={theme === name ? "primary" : "ghost"}
          aria-pressed={theme === name}
          onClick={() => setTheme(name)}
          className="h-8 rounded-lg px-2 text-[12px] font-medium"
        >
          {THEME_LABELS[name]}
        </Button>
      ))}
    </div>
  );
}
