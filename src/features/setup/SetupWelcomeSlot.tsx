import { useRef, useState } from "react";
import { useSetupStateQuery, useUpdateSetupState } from "../../api/setup.js";
import { useWelcomeStore } from "../../store/welcomeStore.js";
import { useOptionalToast } from "../../ui/Toast.js";
import { useT } from "../../i18n/t.js";
import { WelcomeCard } from "../experiencia/WelcomeCard.js";
import { SetupFlow } from "./SetupFlow.js";

/**
 * The first-run slot over Kira's stage (setup-assistant-20261008 T4).
 *
 * - Backend first: GET /api/setup/state `show_on_start` decides whether the
 *   assistant opens. Closing records "skipped", finishing records "completed",
 *   so neither auto-opens again.
 * - The "show welcome" menu action (welcomeStore.restore) always reopens it.
 * - If the setup route is unreachable (older backend, error), the previous
 *   localStorage WelcomeCard behaviour takes over so the app never breaks.
 */
export function SetupWelcomeSlot() {
  const t = useT();
  const toast = useOptionalToast();
  const query = useSetupStateQuery();
  const updateSetup = useUpdateSetupState();
  // The flow is already gone when the write fails: say so instead of failing silently.
  const record = (status: "skipped" | "completed") =>
    updateSetup.mutate(status, { onError: () => toast?.toast(t("setup.close.saveError"), { tone: "warn" }) });
  const dismissed = useWelcomeStore((state) => state.dismissed);
  const dismiss = useWelcomeStore((state) => state.dismiss);
  const reopenSeq = useWelcomeStore((state) => state.reopenSeq);
  const mountSeq = useRef(reopenSeq).current;
  // The reopenSeq value current when the user last closed or finished the flow.
  const [closedAtSeq, setClosedAtSeq] = useState<number | null>(null);

  if (query.isError) {
    return !dismissed ? <WelcomeCard onDismiss={dismiss} /> : null;
  }

  const open =
    closedAtSeq === reopenSeq
      ? false
      : reopenSeq !== mountSeq || (closedAtSeq === null && Boolean(query.data?.show_on_start));

  if (!open) return null;

  function handleClose() {
    setClosedAtSeq(reopenSeq);
    dismiss();
    const state = query.data;
    // Never downgrade a setup that is complete and working (reopened from the menu).
    if (!(state?.status === "completed" && state.engine_ready)) {
      record("skipped");
    }
  }

  function handleComplete() {
    setClosedAtSeq(reopenSeq);
    dismiss();
    record("completed");
  }

  const data = query.data;
  return (
    <SetupFlow
      variant="modal"
      onClose={handleClose}
      onComplete={handleComplete}
      checkpoint={data?.status === "completed" ? null : data?.checkpoint ?? null}
      checkpointReset={Boolean(data?.checkpoint_reset)}
    />
  );
}
