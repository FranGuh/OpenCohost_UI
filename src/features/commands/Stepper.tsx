import { useState } from "react";
import { cn } from "../../lib/cn.js";
import { useT } from "../../i18n/t.js";
import { Button } from "../../ui/Button.js";
import {
  ActionRow,
  AnswerChip,
  SectionHeading,
  SegmentedStep,
  SelectStep,
  SummaryCard,
  TagsStep,
  TextStep,
  formatChipValue,
  type StepDef,
  type StepValue
} from "./primitives.js";
import type { Command } from "./registry.js";

/**
 * Stepper engine — drives a command's `steps` one question at a time. Answered
 * steps collapse to chips; the flow ends on a SummaryCard (Editar/Descartar)
 * followed by the inert ActionRow. MOCKUP: no step advances anything real.
 */

function initialValues(steps: readonly StepDef[]): Record<string, StepValue> {
  const values: Record<string, StepValue> = {};
  for (const step of steps) {
    if (step.kind === "tags") values[step.id] = [];
    else if (step.kind === "select" || step.kind === "segmented") values[step.id] = step.default;
    else values[step.id] = "";
  }
  return values;
}

/** Only a required, still-empty text step blocks advancing. Everything else
 * (selects have defaults, tags/optional are skippable) is free. */
function canAdvance(step: StepDef, value: StepValue): boolean {
  if (step.kind === "text" && !step.optional) return (value as string).trim().length > 0;
  return true;
}

function isFirstOfSection(steps: readonly StepDef[], index: number): boolean {
  const section = steps[index].section;
  if (!section) return false;
  const previous = steps[index - 1]?.section;
  // Compares KEYS, not resolved copy — grouping stays stable in any locale.
  return previous?.labelKey !== section.labelKey;
}

function ProgressDots({ index, total }: { index: number; total: number }) {
  return (
    <div className="mt-1 flex gap-1" aria-hidden="true">
      {Array.from({ length: total }, (_, dot) => (
        <span
          key={dot}
          className={cn(
            "block h-1.5 rounded-full transition-all duration-fast ease-io",
            dot === index ? "w-6 bg-primary" : "w-1.5 bg-border"
          )}
        />
      ))}
    </div>
  );
}

function StepControl({
  step,
  value,
  onChange,
  onAdvance
}: {
  step: StepDef;
  value: StepValue;
  onChange: (value: StepValue) => void;
  onAdvance: () => void;
}) {
  switch (step.kind) {
    case "text":
      return <TextStep step={step} value={value as string} onChange={onChange} onAdvance={onAdvance} />;
    case "select":
      return <SelectStep step={step} value={value as string} onChange={onChange} />;
    case "segmented":
      return <SegmentedStep step={step} value={value as string} onChange={onChange} />;
    case "tags":
      return <TagsStep step={step} value={value as string[]} onChange={onChange} />;
  }
}

export function Stepper({
  command,
  onDiscard,
  onCancel
}: {
  command: Command;
  /** Back to the command list (Descartar). */
  onDiscard: () => void;
  /** Close the whole palette (Cancelar). */
  onCancel: () => void;
}) {
  const t = useT();
  const steps = command.steps ?? [];
  const [values, setValues] = useState<Record<string, StepValue>>(() => initialValues(steps));
  const [cursor, setCursor] = useState(0);
  // Bumped by `reset` to remount the ActionRow so its in-flight/`submittingRef`
  // guard clears — a fresh submit works after "Cargar otro" (Item 1).
  const [resetKey, setResetKey] = useState(0);

  // Steps whose `when` gate passes for the current answers. Commands without any
  // `when` yield the full list unchanged (their flow stays byte-identical).
  const visible = steps.filter((step) => !step.when || step.when(values));

  const atSummary = cursor >= visible.length;
  const activeStep = atSummary ? null : visible[cursor];

  function advance() {
    setCursor((current) => Math.min(visible.length, current + 1));
  }

  // "Cargar otro" (Item 1): clear every answer, jump back to the first step, and
  // remount the ActionRow so its idle/submittingRef state re-arms.
  function reset() {
    setValues(initialValues(steps));
    setCursor(0);
    setResetKey((key) => key + 1);
  }

  return (
    // max-w-[560px] caps the whole stepper form (steps, summary, action row) so
    // fields stop stretching across a wide panel; fields keep w-full within it.
    <div className="flex max-w-[560px] flex-col gap-3">
      {/* Answered steps collapse to chips so the flow reads one-at-a-time. */}
      {cursor > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {visible.slice(0, cursor).map((step) => (
            <AnswerChip key={step.id} label={t(step.chipLabelKey)} value={formatChipValue(step, values[step.id])} />
          ))}
        </div>
      )}

      {activeStep ? (
        <div key={activeStep.id} className="flex flex-col gap-2">
          {isFirstOfSection(visible, cursor) && activeStep.section && <SectionHeading section={activeStep.section} />}
          <p className="text-sm font-semibold text-foreground">{t(activeStep.questionKey)}</p>
          <StepControl
            step={activeStep}
            value={values[activeStep.id]}
            onChange={(value) => setValues((prev) => ({ ...prev, [activeStep.id]: value }))}
            onAdvance={() => {
              if (canAdvance(activeStep, values[activeStep.id])) advance();
            }}
          />
          <div className="mt-1 flex items-center justify-between gap-3">
            <Button
              type="button"
              variant="primary"
              disabled={!canAdvance(activeStep, values[activeStep.id])}
              onClick={advance}
              className="disabled:cursor-not-allowed disabled:opacity-40"
            >
              {cursor === visible.length - 1 ? t("commands.stepper.review.action") : t("commands.stepper.next.action")}
            </Button>
            <button
              type="button"
              onClick={onCancel}
              className="rounded-md px-3 py-1.5 text-sm font-semibold text-muted-foreground transition-colors duration-fast ease-io hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              {t("commands.stepper.cancel.action")}
            </button>
          </div>
          <ProgressDots index={cursor} total={visible.length} />
        </div>
      ) : (
        <>
          <SummaryCard
            title={command.summaryTitleKey ? t(command.summaryTitleKey) : t("commands.stepper.summary.title")}
            steps={visible}
            values={values}
            onEdit={() => setCursor(0)}
            onDiscard={onDiscard}
          />
          <ActionRow
            key={resetKey}
            primaryLabel={
              typeof command.primaryLabelKey === "function"
                ? t(command.primaryLabelKey(values))
                : command.primaryLabelKey
                  ? t(command.primaryLabelKey)
                  : t("commands.stepper.confirm.action")
            }
            note={t(command.actionNoteKey ?? "commands.stepper.action.note")}
            onSubmit={command.submit ? () => command.submit!(values) : undefined}
            onCancel={onCancel}
            onReset={reset}
            resetLabel={command.resetLabelKey ? t(command.resetLabelKey) : undefined}
          />
        </>
      )}
    </div>
  );
}
