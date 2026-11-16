import { useState } from "react";
import { Alert } from "../../ui/Alert.js";
import { Button } from "../../ui/Button.js";
import { useT, type TKey } from "../../i18n/t.js";
import { reloadBackend } from "../../lib/backendControl.js";

/** What to do once the backend came back from a restart (mutable for tests). */
export const RESTART_HOOK = { afterReload: () => window.location.reload() };

type RestartState = "idle" | "restarting" | "failed";

export interface RestartToApplyProps {
  notice: TKey;
  /** Optional pre-restart persistence hook (e.g. flushing setup checkpoint to the next step). */
  onBeforeRestart?: () => Promise<void> | void;
}

/**
 * Informational "Kira's language applies after a restart" notice with the
 * Restart to apply button. Shared by the setup wizard and the settings popover
 * so both reload the backend through the same handler.
 */
export function RestartToApply({ notice, onBeforeRestart }: RestartToApplyProps) {
  const t = useT();
  const [restart, setRestart] = useState<RestartState>("idle");

  async function handleRestart() {
    setRestart("restarting");
    try {
      await onBeforeRestart?.();
    } catch {
      // Best-effort pre-restart hook must never block restarting.
    }
    const result = await reloadBackend();
    if (!result.ok) {
      setRestart("failed");
      return;
    }
    // The backend may listen elsewhere now: start the app over; the saved setup progress resumes it.
    RESTART_HOOK.afterReload();
  }

  return (
    <div role="status" className="flex flex-col items-start gap-2">
      <p className="max-w-xl text-sm leading-relaxed text-muted-foreground">{t(notice)}</p>
      <Button type="button" variant="primary" disabled={restart === "restarting"} onClick={() => void handleRestart()}>
        {restart === "restarting" ? t("setup.voice.restart.restarting") : t("setup.voice.restart.action")}
      </Button>
      {restart === "failed" && <Alert tone="warn" role="status">{t("setup.voice.restart.failed")}</Alert>}
    </div>
  );
}
