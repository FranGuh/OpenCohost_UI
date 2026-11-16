import { useSetupStateQuery } from "../../api/setup.js";
import { useT } from "../../i18n/t.js";

/**
 * One quiet nudge when the user skipped setup and no engine can answer yet
 * (setup-assistant-20261008 T4). Reads the same cached GET /api/setup/state
 * the welcome slot uses; renders nothing otherwise or when the route fails.
 */
export function SetupHint() {
  const t = useT();
  const { data } = useSetupStateQuery();
  if (!data || data.status !== "skipped" || data.engine_ready) return null;
  return (
    <span className="mono shrink-0 whitespace-nowrap rounded-full border border-border-soft px-2.5 py-1 text-[11.5px] text-muted-foreground">
      {t("setup.hint.noEngine")}
    </span>
  );
}
