import { useId, useState } from "react";
import { Button } from "../../ui/Button.js";
import { Card } from "../../ui/Card.js";
import { CollapsibleHeader, CollapsibleBody, useCollapsible } from "../../ui/Collapsible.js";
import { Segmented } from "../../ui/Segmented.js";
import { useT } from "../../i18n/t.js";
import {
  useDecisionsQuery,
  useDecisionsSave,
  useDecisionWorkerRestart,
  type DecisionId,
  type DecisionMode,
  type DecisionSetting,
  type DecisionWorker,
  type DecisionsPatch
} from "../../api/decisions.js";

const THRESHOLD_MIN = 0.5;
const THRESHOLD_MAX = 0.99;

const ROWS = [
  { id: "vision", label: "controles.decisions.vision.label", hint: "controles.decisions.vision.hint", canBeOn: true },
  { id: "memory", label: "controles.decisions.memory.label", hint: "controles.decisions.memory.hint", canBeOn: true },
  {
    id: "reply_length",
    label: "controles.decisions.replyLength.label",
    hint: "controles.decisions.replyLength.hint",
    canBeOn: true
  },
  { id: "respond", label: "controles.decisions.respond.label", hint: "controles.decisions.respond.hint", canBeOn: false }
] as const satisfies readonly { id: DecisionId; label: string; hint: string; canBeOn: boolean }[];

const MODE_LABEL = {
  off: "controles.decisions.mode.off",
  shadow: "controles.decisions.mode.shadow",
  on: "controles.decisions.mode.on"
} as const satisfies Record<DecisionMode, string>;

function workerLabel(worker: DecisionWorker) {
  if (worker.state === "ready") return "controles.decisions.worker.ready";
  if (worker.state === "starting") return "controles.decisions.worker.starting";
  if (worker.state === "error") return "controles.decisions.worker.error";
  return "controles.decisions.worker.unavailable";
}

function clampThreshold(value: number): number {
  return Math.round(Math.min(THRESHOLD_MAX, Math.max(THRESHOLD_MIN, value)) * 100) / 100;
}

interface ThresholdInputProps {
  id: string;
  label: string;
  value: number;
  disabled: boolean;
  onCommit: (value: number) => void;
}

/** Number input that keeps a local draft and commits on blur / Enter. */
function ThresholdInput({ id, label, value, disabled, onCommit }: ThresholdInputProps) {
  const [draft, setDraft] = useState<string | null>(null);

  function commit() {
    if (draft === null) return;
    setDraft(null);
    const parsed = Number(draft);
    if (draft.trim() === "" || !Number.isFinite(parsed)) return;
    const next = clampThreshold(parsed);
    if (next !== value) onCommit(next);
  }

  return (
    <input
      id={id}
      type="number"
      aria-label={label}
      min={THRESHOLD_MIN}
      max={THRESHOLD_MAX}
      step={0.01}
      disabled={disabled}
      value={draft ?? String(value)}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter") commit();
      }}
      className="h-9 w-20 rounded-md border border-[var(--border)] bg-[var(--background)] px-2 text-right text-sm text-[var(--foreground)] disabled:cursor-not-allowed disabled:opacity-60"
    />
  );
}

interface DecisionRowProps {
  row: (typeof ROWS)[number];
  setting: DecisionSetting;
  disabled: boolean;
  onChange: (patch: DecisionsPatch) => void;
}

function DecisionRow({ row, setting, disabled, onChange }: DecisionRowProps) {
  const t = useT();
  const hintId = useId();
  const noteId = useId();
  const thresholdId = useId();
  const modes: DecisionMode[] = row.canBeOn ? ["off", "shadow", "on"] : ["off", "shadow"];
  const options = modes.map((value) => ({ value, label: t(MODE_LABEL[value]) }));
  const label = t(row.label);

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-[13px] font-semibold text-foreground">{label}</span>
        <label htmlFor={thresholdId} className="flex items-center gap-2 text-[11px] text-muted-foreground">
          <span aria-hidden="true">{t("controles.decisions.threshold")}</span>
          <ThresholdInput
            id={thresholdId}
            label={t("controles.decisions.threshold.aria", { name: label })}
            value={setting.threshold}
            disabled={disabled || setting.mode !== "on"}
            onCommit={(threshold) => onChange({ [row.id]: { threshold } })}
          />
        </label>
      </div>
      <Segmented
        options={options}
        value={setting.mode}
        onChange={(mode) => {
          if (mode !== setting.mode) onChange({ [row.id]: { mode } });
        }}
        ariaLabel={label}
        ariaDescribedBy={row.canBeOn ? hintId : `${hintId} ${noteId}`}
        disabled={disabled}
      />
      <p id={hintId} className="text-xs leading-relaxed text-muted-foreground">
        {t(row.hint)}
      </p>
      {!row.canBeOn && (
        <p id={noteId} className="text-xs leading-relaxed text-muted-foreground">
          {t("controles.decisions.respond.note")}
        </p>
      )}
    </div>
  );
}

/**
 * Decision layer (GET/PUT /api/decisions, POST /api/decisions/worker/restart).
 * Container: owns the query, the optimistic save and the inline error. Each
 * change saves immediately (thresholds on blur / Enter). When the GET fails
 * the rows are not rendered and the error stays visible.
 */
export function DecisionsCard() {
  const t = useT();
  const { data, isError: loadError, isPending } = useDecisionsQuery();
  const save = useDecisionsSave();
  const restart = useDecisionWorkerRestart();
  const [saveError, setSaveError] = useState<"rejected" | "failed" | null>(null);
  const [isOpen, toggleOpen] = useCollapsible(true, "decisions-laya");
  const bodyId = "oc-collapsible-body-decisions-laya";

  function change(patch: DecisionsPatch) {
    setSaveError(null);
    save.mutate(patch, {
      onError: (error) => setSaveError((error as { status?: number }).status === 422 ? "rejected" : "failed")
    });
  }

  return (
    <Card className="flex flex-col p-4">
      <CollapsibleHeader isOpen={isOpen} onToggle={toggleOpen} bodyId={bodyId}>
        <h2 className="text-sm font-bold text-foreground">{t("controles.decisions.title")}</h2>
      </CollapsibleHeader>
      <CollapsibleBody isOpen={isOpen} id={bodyId}>
        <div className="flex flex-col gap-3.5">
          {isPending && <p className="text-xs leading-relaxed text-muted-foreground">{t("controles.decisions.loading")}</p>}
          {data && (
            <>
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <span>{t("controles.decisions.worker.label")}</span>
                <span className="font-semibold text-foreground">{t(workerLabel(data.worker))}</span>
                {data.worker.state === "error" && (
                  <>
                    {data.worker.last_error && <code className="text-danger">{data.worker.last_error}</code>}
                    <Button type="button" onClick={() => restart.mutate()} disabled={restart.isPending}>
                      {t("controles.decisions.worker.restart")}
                    </Button>
                  </>
                )}
              </div>
              <p className="text-xs leading-relaxed text-muted-foreground">{t("controles.decisions.shadow.hint")}</p>
              {ROWS.map((row) => (
                <DecisionRow key={row.id} row={row} setting={data.decisions[row.id]} disabled={false} onChange={change} />
              ))}
            </>
          )}
          {(loadError || saveError || restart.isError) && (
            <p role="alert" className="text-xs leading-relaxed text-danger">
              {loadError
                ? t("controles.decisions.error.load")
                : saveError === "rejected"
                  ? t("controles.decisions.error.rejected")
                  : saveError === "failed"
                    ? t("controles.decisions.error.save")
                    : t("controles.decisions.error.restart")}
            </p>
          )}
        </div>
      </CollapsibleBody>
    </Card>
  );
}
