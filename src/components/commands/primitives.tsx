import { useRef, useState } from "react";
import type { ReactNode } from "react";
import { Info } from "lucide-react";
import { cn } from "../../lib/cn.js";
import { Button } from "../ui/Button.js";
import { Select } from "../ui/Select.js";
import { Segmented } from "../ui/Segmented.js";
import { errorCopy } from "./wire.js";

/**
 * Reusable command-palette primitives — MOCKUP ONLY. The chat command palette
 * (ComposerCommandPanel) walks the operator through a command one question at a
 * time; each answered step collapses to a chip and every stepper ends on a
 * SummaryCard whose final action is inert. These are the shared building blocks
 * so a new command is a data definition (see registry.tsx), not new UI.
 *
 * Nothing here calls the network or mutates a store — the final actions render
 * disabled and carry a "maquetado" acknowledgement instead.
 */

export interface StepOption {
  value: string;
  label: string;
}

/** A visual grouping header (e.g. Identidad / Sesión) shown above the first
 * step of a section; `note` is the small inline hint like "se aplica al instante". */
export interface SectionMeta {
  label: string;
  note?: string;
}

interface StepCommon {
  id: string;
  /** Visible question/heading AND the control's accessible name. */
  question: string;
  /** Short label used when the answered step collapses to a chip. */
  chipLabel: string;
  section?: SectionMeta;
  /** Conditional gate: the step only appears (and collapses/summarizes) when
   * this returns true for the current answers. Absent = always shown. */
  when?: (values: Record<string, StepValue>) => boolean;
}

export type StepDef =
  | (StepCommon & { kind: "text"; placeholder?: string; maxLength?: number; multiline?: boolean; optional?: boolean })
  | (StepCommon & { kind: "select"; options: readonly StepOption[]; default: string })
  | (StepCommon & { kind: "segmented"; options: readonly StepOption[]; default: string })
  | (StepCommon & { kind: "tags"; placeholder?: string });

/** text/select/segmented carry a string; tags carries a string[]. */
export type StepValue = string | string[];

const FIELD_CLASSES =
  "w-full rounded-md border border-border-soft bg-surface-2 px-3 py-2 text-sm text-foreground outline-none placeholder:text-dim focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";

// ─── Answer chip (collapsed answered step) ──────────────────────────────────

export function AnswerChip({ label, value }: { label: string; value: string }) {
  return (
    <span className="mono inline-flex items-center gap-1.5 rounded-full border border-border-soft bg-surface-2 px-2.5 py-1 text-[11px] text-muted-foreground">
      <span className="text-dim">{label}</span>
      <span className="text-foreground">{value}</span>
    </span>
  );
}

/** Render an answered step's value the way its chip should read. */
export function formatChipValue(step: StepDef, value: StepValue | undefined): string {
  switch (step.kind) {
    case "select":
    case "segmented": {
      const option = step.options.find((candidate) => candidate.value === value);
      return option ? option.label : String(value ?? "");
    }
    case "tags": {
      const tags = (value as string[] | undefined) ?? [];
      return tags.length > 0 ? tags.join(", ") : "sin etiquetas";
    }
    default: {
      const text = ((value as string | undefined) ?? "").trim();
      return text || "—";
    }
  }
}

// ─── Section heading + quiet note ───────────────────────────────────────────

export function SectionHeading({ section }: { section: SectionMeta }) {
  return (
    <div className="flex items-baseline gap-2">
      <span className="text-[11px] font-semibold uppercase tracking-[0.09em] text-dim">{section.label}</span>
      {section.note && <span className="mono text-[10px] text-dim">{section.note}</span>}
    </div>
  );
}

export function InfoNote({ children }: { children: ReactNode }) {
  return (
    <p className="flex items-start gap-1.5 text-xs leading-relaxed text-muted-foreground">
      <Info size={12} className="mt-0.5 shrink-0" aria-hidden="true" />
      <span>{children}</span>
    </p>
  );
}

// ─── Step input primitives ──────────────────────────────────────────────────

export function TextStep({
  step,
  value,
  onChange,
  onAdvance
}: {
  step: Extract<StepDef, { kind: "text" }>;
  value: string;
  onChange: (value: string) => void;
  onAdvance: () => void;
}) {
  // Slice on change so the cap holds even under programmatic (test) input —
  // native maxLength only stops real keystrokes, not fireEvent.change.
  const handleChange = (raw: string) => onChange(step.maxLength ? raw.slice(0, step.maxLength) : raw);
  return (
    <div className="flex flex-col gap-1">
      {step.multiline ? (
        <textarea
          autoFocus
          rows={2}
          aria-label={step.question}
          value={value}
          placeholder={step.placeholder}
          onChange={(event) => handleChange(event.target.value)}
          className={cn(FIELD_CLASSES, "min-h-[64px] resize-y")}
        />
      ) : (
        <input
          autoFocus
          type="text"
          aria-label={step.question}
          value={value}
          placeholder={step.placeholder}
          onChange={(event) => handleChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              onAdvance();
            }
          }}
          className={FIELD_CLASSES}
        />
      )}
      {step.maxLength ? (
        <span className="self-end text-[11px] text-dim" aria-live="polite">
          {value.length}/{step.maxLength}
        </span>
      ) : null}
    </div>
  );
}

export function SelectStep({
  step,
  value,
  onChange
}: {
  step: Extract<StepDef, { kind: "select" }>;
  value: string;
  onChange: (value: string) => void;
}) {
  return <Select aria-label={step.question} options={step.options} value={value} onChange={onChange} />;
}

export function SegmentedStep({
  step,
  value,
  onChange
}: {
  step: Extract<StepDef, { kind: "segmented" }>;
  value: string;
  onChange: (value: string) => void;
}) {
  return <Segmented ariaLabel={step.question} options={step.options} value={value} onChange={onChange} />;
}

export function TagsStep({
  step,
  value,
  onChange
}: {
  step: Extract<StepDef, { kind: "tags" }>;
  value: string[];
  onChange: (value: string[]) => void;
}) {
  const [draft, setDraft] = useState("");

  function add(raw: string) {
    const clean = raw.trim();
    setDraft("");
    if (!clean || value.includes(clean)) return;
    onChange([...value, clean]);
  }

  return (
    <div className="flex flex-col gap-1.5">
      <input
        autoFocus
        type="text"
        aria-label={step.question}
        value={draft}
        placeholder={step.placeholder ?? "Enter para agregar"}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === ",") {
            event.preventDefault();
            add(draft);
          }
        }}
        className={FIELD_CLASSES}
      />
      {value.length > 0 && (
        <ul aria-label="Etiquetas agregadas" className="flex flex-wrap gap-1.5">
          {value.map((tag) => (
            <li
              key={tag}
              className="inline-flex items-center gap-1.5 rounded-full border border-border-soft bg-surface-2 px-2.5 py-1 text-xs text-foreground"
            >
              {tag}
              <button
                type="button"
                aria-label={`Quitar etiqueta ${tag}`}
                onClick={() => onChange(value.filter((candidate) => candidate !== tag))}
                className="text-dim transition-colors duration-fast ease-io hover:text-danger"
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ─── Summary + action row (stepper tail) ────────────────────────────────────

export function SummaryCard({
  title,
  steps,
  values,
  onEdit,
  onDiscard
}: {
  title: string;
  steps: readonly StepDef[];
  values: Record<string, StepValue>;
  onEdit: () => void;
  onDiscard: () => void;
}) {
  return (
    <div className="flex flex-col gap-2.5 rounded-md border border-border-soft bg-surface-2 p-3 animate-rise-in">
      <p className="text-sm font-semibold text-foreground">{title}</p>
      <div className="flex flex-wrap gap-1.5">
        {steps.map((step) => (
          <AnswerChip key={step.id} label={step.chipLabel} value={formatChipValue(step, values[step.id])} />
        ))}
      </div>
      <div className="flex items-center gap-2">
        <Button type="button" variant="outline" className="h-8 px-3 text-[13px]" onClick={onEdit}>
          Editar
        </Button>
        <Button type="button" variant="ghost" className="h-8 px-3 text-[13px]" onClick={onDiscard}>
          Descartar
        </Button>
      </div>
    </div>
  );
}

/**
 * Stepper tail action (D4/R1-R3). When a command supplies `onSubmit`, this is a
 * real submit pipe: idle → pending (disabled, in-flight) → settled (ack from
 * the resolved response). On failure it re-enables for a retry and NEVER resets
 * the parent stepper's values (they live in `Stepper` state, R2). Commands not
 * yet migrated (no `onSubmit`) keep the original inert DISABLED + "maquetado"
 * mockup byte-for-byte, so they don't regress before their WU lands.
 */
export function ActionRow({
  primaryLabel,
  note,
  onSubmit,
  onCancel
}: {
  primaryLabel: string;
  note: string;
  onSubmit?: () => Promise<string>;
  onCancel: () => void;
}) {
  const [phase, setPhase] = useState<"idle" | "pending" | "settled">("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  // Synchronous guard (F1/F7): `phase` is React state, so two synchronous
  // clicks can both fire before "pending" re-renders and disables the button.
  // A ref reads/writes immediately, so the second click is dropped in-line.
  const submittingRef = useRef(false);

  const cancelButton = (
    <button
      type="button"
      onClick={onCancel}
      className="rounded-md px-3 py-1.5 text-sm font-semibold text-muted-foreground transition-colors duration-fast ease-io hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
    >
      Cancelar
    </button>
  );

  // Not-yet-migrated command → original inert mockup (unchanged markup).
  if (!onSubmit) {
    return (
      <div className="mt-1 flex items-center justify-between gap-3 border-t border-border-soft pt-3">
        <div className="flex flex-col">
          <Button type="button" variant="primary" disabled className="self-start opacity-40 disabled:cursor-not-allowed">
            {primaryLabel}
          </Button>
          <span className="mt-1 text-[11px] text-dim">{note}</span>
        </div>
        {cancelButton}
      </div>
    );
  }

  async function handleSubmit() {
    if (submittingRef.current) return;
    submittingRef.current = true;
    setPhase("pending");
    setMessage(null);
    setFailed(false);
    try {
      const ack = await onSubmit!();
      setPhase("settled");
      setMessage(ack);
      // Settled is terminal (button stays disabled via `busy || done`) — no
      // reset needed here, this row is never resubmitted.
    } catch (err) {
      // R2: entered values live in the parent Stepper — reset nothing here.
      submittingRef.current = false;
      setPhase("idle");
      setFailed(true);
      setMessage(errorCopy(err));
    }
  }

  const busy = phase === "pending";
  const done = phase === "settled";

  return (
    <div className="mt-1 flex items-center justify-between gap-3 border-t border-border-soft pt-3">
      <div className="flex flex-col">
        <Button
          type="button"
          variant="primary"
          disabled={busy || done}
          onClick={handleSubmit}
          className="self-start disabled:cursor-not-allowed disabled:opacity-40"
        >
          {busy ? "Enviando…" : primaryLabel}
        </Button>
        {message && (
          <span role="status" aria-live="polite" className={cn("mt-1 text-[11px]", failed ? "text-danger" : "text-dim")}>
            {message}
          </span>
        )}
      </div>
      {cancelButton}
    </div>
  );
}
