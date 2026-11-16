import { useState, type ReactNode } from "react";
import { ShieldCheck } from "lucide-react";
import { Card } from "../../ui/Card.js";
import { Badge } from "../../ui/Badge.js";
import { Switch } from "../../ui/Switch.js";
import { cn } from "../../lib/cn.js";
import { useT } from "../../i18n/t.js";
import { VisionModelPicker } from "./VisionModelPicker.js";
import {
  VisionValidationError,
  useVisionQuery,
  useVisionUpdate,
  type VisionUpdate
} from "../../api/vision.js";
import { VisionSourceSection } from "./VisionSourceSection.js";

const DELAY_MIN_S = 0;
const DELAY_MAX_S = 10;

const FRAMES_MIN = 1;
const FRAMES_MAX = 3;
const FRAMES_DEFAULT = 3;
const INTERVAL_MIN_S = 0.5;
const INTERVAL_MAX_S = 3;
const INTERVAL_DEFAULT_S = 1;

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));

function formatVisionSaveError(error: unknown, validationPrefix: string, fallback: string): string {
  if (error instanceof VisionValidationError) {
    const details = error.errors
      .map((entry) => `${entry.field}: ${entry.code}`)
      .filter(Boolean)
      .join(", ");
    if (details) return `${validationPrefix}: ${details}`;
    if (error.message) return error.message;
  }
  return fallback;
}

interface NumberRowProps {
  id: string;
  label: string;
  hint: string;
  value: number | undefined;
  min: number;
  max: number;
  step: number;
  disabled: boolean;
  /** Normalise a parsed draft (clamp, round) before comparing and saving. */
  normalize: (n: number) => number;
  onCommit: (n: number) => void;
}

/** Number input holding a draft until commit (blur or Enter); an empty or
 * non-numeric draft, or an unchanged value, saves nothing. */
function NumberRow({ id, label, hint, value, min, max, step, disabled, normalize, onCommit }: NumberRowProps) {
  const [draft, setDraft] = useState<string | null>(null);

  function commit() {
    if (draft === null) return;
    const parsed = Number(draft);
    setDraft(null);
    if (draft.trim() === "" || !Number.isFinite(parsed)) return;
    const next = normalize(parsed);
    if (next !== value) onCommit(next);
  }

  return (
    <div className="grid grid-cols-[1fr_auto] items-center gap-3">
      <div className="flex flex-col gap-0.5">
        <label htmlFor={id} className="text-[13px] text-foreground">
          {label}
        </label>
        <span className="text-[11px] leading-tight text-dim">{hint}</span>
      </div>
      <input
        id={id}
        type="number"
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        value={draft ?? (value === undefined ? "" : String(value))}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") commit();
        }}
        className="h-9 w-20 rounded-md border border-white/[0.08] bg-background/80 px-2.5 text-right text-sm text-foreground transition-colors duration-fast ease-io focus:border-sky-500/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/30 disabled:cursor-not-allowed disabled:opacity-60"
      />
    </div>
  );
}

interface SwitchRowProps {
  label: string;
  hint?: string;
  checked: boolean;
  disabled: boolean;
  onChange: (checked: boolean) => void;
}

function SwitchRow({ label, hint, checked, disabled, onChange }: SwitchRowProps) {
  return (
    <div className="grid grid-cols-[1fr_auto] items-center gap-3">
      <div className="flex flex-col gap-0.5">
        <span className="text-[13px] text-foreground">{label}</span>
        {hint && <span className="text-[11px] leading-tight text-dim">{hint}</span>}
      </div>
      <Switch checked={checked} disabled={disabled} onChange={onChange} aria-label={label} />
    </div>
  );
}

const LOOK_MODES = ["normal", "text", "clip"] as const;

/** How to trigger each look mode (backend gate.py look_mode and /mira aliases).
 * Text only by owner decision: looks are asked for by voice or chat, never by a
 * test button. */
function LookModesGuide() {
  const t = useT();
  return (
    <section
      aria-label={t("controles.vision.howTo.title")}
      className="flex flex-col gap-2.5 rounded-xl border border-white/[0.06] bg-surface-2/35 p-3"
    >
      <h3 className="text-xs font-semibold text-foreground">{t("controles.vision.howTo.title")}</h3>
      <ul className="flex flex-col gap-2 text-xs">
        {LOOK_MODES.map((mode) => (
          <li
            key={mode}
            className="flex flex-col gap-1 rounded-lg border border-white/[0.06] bg-background/40 p-2.5"
          >
            <div className="flex flex-wrap items-center gap-1.5 text-foreground">
              <span className="font-semibold text-foreground">{t(`controles.vision.howTo.${mode}.label`)}</span>
              <span className="text-dim">·</span>
              <span className="text-xs text-muted-foreground">{t(`controles.vision.howTo.${mode}.example`)}</span>
              <span className="text-xs text-dim">{t("controles.vision.howTo.or")}</span>
              <code className="mono rounded border border-white/[0.06] bg-surface-2 px-1.5 py-0.5 text-[11px] font-medium text-foreground">
                {t(`controles.vision.howTo.${mode}.command`)}
              </code>
            </div>
            <span className="text-[11px] leading-relaxed text-dim">{t(`controles.vision.howTo.${mode}.desc`)}</span>
          </li>
        ))}
      </ul>
      <p className="border-t border-white/[0.06] pt-2 text-[11px] leading-snug text-dim">
        {t("controles.vision.howTo.footer")}
      </p>
    </section>
  );
}

interface SectionBlockProps {
  step: number;
  title: string;
  subtitle: string;
  children: ReactNode;
}

/** Numbered group container giving non-technical streamers clear visual pacing. */
function SectionBlock({ step, title, subtitle, children }: SectionBlockProps) {
  return (
    <section
      aria-label={title}
      className="flex flex-col gap-3 rounded-xl border border-slate-800/80 bg-surface-2/25 p-3.5"
    >
      <div className="flex items-start gap-2.5 border-b border-white/[0.06] pb-2.5">
        <span
          aria-hidden="true"
          className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-sky-500/30 bg-sky-500/10 text-[11px] font-bold text-sky-300"
        >
          {step}
        </span>
        <div className="flex flex-col gap-0.5">
          <h3 className="text-[13px] font-semibold text-foreground">{title}</h3>
          <p className="text-[11.5px] leading-snug text-muted-foreground">{subtitle}</p>
        </div>
      </div>
      {children}
    </section>
  );
}

/**
 * Vision-on-demand owner controls (GET/PUT /api/vision). Every change is a
 * partial PUT with an optimistic cache update that rolls back on failure
 * (useVisionUpdate). The delay is a draft until commit (blur or Enter).
 */
export function VisionCard() {
  const t = useT();
  const { data, isError: loadError } = useVisionQuery();
  const update = useVisionUpdate();
  const save = (updates: VisionUpdate) => update.mutate(updates);

  const status = data?.status;
  const disabled = !data;
  const enabled = data?.enabled ?? false;

  return (
    <Card className="flex flex-col p-4">
      <div className="flex items-center justify-between gap-3 border-b border-white/[0.06] pb-3">
        <div className="flex items-center gap-2.5">
          <h2 className="text-sm font-bold text-foreground">{t("controles.vision.title")}</h2>
          {data && (
            <Badge tone={enabled ? "ok" : "neutral"} className="px-2 py-0.5 text-[11px]">
              {enabled ? t("controles.vision.badge.active") : t("controles.vision.badge.inactive")}
            </Badge>
          )}
        </div>
        {update.isPending && <Badge tone="info">{t("controles.vision.saving")}</Badge>}
      </div>

      <div className="flex flex-col gap-4 pt-3.5">
        <p className="text-xs leading-relaxed text-muted-foreground">{t("controles.vision.hint")}</p>

        {(loadError || update.isError) && (
          <p role="alert" className="text-xs leading-relaxed text-danger">
            {loadError
              ? t("controles.vision.error.load")
              : formatVisionSaveError(
                  update.error,
                  t("controles.vision.error.validation"),
                  t("controles.vision.error.save")
                )}
          </p>
        )}

        {/* 1. Activation & how Kira looks */}
        <SectionBlock
          step={1}
          title={t("controles.vision.section.activation.title")}
          subtitle={t("controles.vision.section.activation.subtitle")}
        >
          <div
            className={cn(
              "flex flex-col gap-3 rounded-xl border p-3 transition-colors duration-fast ease-io",
              enabled
                ? "border-sky-500/35 bg-sky-500/[0.08]"
                : "border-white/[0.06] bg-surface-2/35"
            )}
          >
            <SwitchRow
              label={t("controles.vision.enabled")}
              checked={enabled}
              disabled={disabled}
              onChange={(nextEnabled) => save({ enabled: nextEnabled })}
            />
            <div className="flex flex-col gap-3 border-t border-white/[0.06] pt-2.5">
              <SwitchRow
                label={t("controles.vision.lookOnPtt")}
                hint={t("controles.vision.lookOnPtt.hint")}
                checked={data?.look_on_ptt ?? false}
                disabled={disabled}
                onChange={(look_on_ptt) => save({ look_on_ptt })}
              />
              <SwitchRow
                label={t("controles.vision.ruleGate")}
                hint={t("controles.vision.ruleGate.hint")}
                checked={data?.rule_gate_enabled ?? false}
                disabled={disabled}
                onChange={(rule_gate_enabled) => save({ rule_gate_enabled })}
              />
            </div>
          </div>

          <LookModesGuide />
        </SectionBlock>

        {/* 2. Vision engine (Local vs Cloud) & model picker */}
        <SectionBlock
          step={2}
          title={t("controles.vision.section.engine.title")}
          subtitle={t("controles.vision.section.engine.subtitle")}
        >
          <VisionSourceSection
            data={data}
            pending={update.isPending}
            onSave={(updates, onSaved) => update.mutate(updates, { onSuccess: onSaved })}
          />
          <VisionModelPicker data={data} onSelect={(model) => save({ model })} />
        </SectionBlock>

        {/* 3. Capture frequency, privacy & engine status */}
        <SectionBlock
          step={3}
          title={t("controles.vision.section.capture.title")}
          subtitle={t("controles.vision.section.capture.subtitle")}
        >
          <div className="flex flex-col gap-3 rounded-xl border border-white/[0.06] bg-surface-2/35 p-3">
            <NumberRow
              id="vision-frames"
              label={t("controles.vision.frames")}
              hint={t("controles.vision.frames.hint")}
              value={data ? (data.frames ?? FRAMES_DEFAULT) : undefined}
              min={FRAMES_MIN}
              max={FRAMES_MAX}
              step={1}
              disabled={disabled}
              normalize={(n) => clamp(Math.round(n), FRAMES_MIN, FRAMES_MAX)}
              onCommit={(frames) => save({ frames })}
            />
            <NumberRow
              id="vision-frame-interval"
              label={t("controles.vision.interval")}
              hint={t("controles.vision.interval.hint")}
              value={data ? (data.frame_interval_s ?? INTERVAL_DEFAULT_S) : undefined}
              min={INTERVAL_MIN_S}
              max={INTERVAL_MAX_S}
              step={0.5}
              disabled={disabled}
              normalize={(n) => clamp(n, INTERVAL_MIN_S, INTERVAL_MAX_S)}
              onCommit={(frame_interval_s) => save({ frame_interval_s })}
            />
            <NumberRow
              id="vision-capture-delay"
              label={t("controles.vision.delay")}
              hint={t("controles.vision.delay.hint")}
              value={data?.capture_delay_s}
              min={DELAY_MIN_S}
              max={DELAY_MAX_S}
              step={0.5}
              disabled={disabled}
              normalize={(n) => clamp(n, DELAY_MIN_S, DELAY_MAX_S)}
              onCommit={(capture_delay_s) => save({ capture_delay_s })}
            />
            <div className="border-t border-white/[0.06] pt-2.5">
              <SwitchRow
                label={t("controles.vision.thumbnails")}
                hint={t("controles.vision.thumbnails.hint")}
                checked={data?.show_thumbnails ?? true}
                disabled={disabled}
                onChange={(show_thumbnails) => save({ show_thumbnails })}
              />
            </div>
          </div>

          <div className="flex items-start gap-2.5 rounded-xl border border-white/[0.06] bg-background/40 px-3 py-2.5">
            <ShieldCheck aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400/80" />
            <p className="text-[11px] leading-relaxed text-muted-foreground">{t("controles.vision.privacy")}</p>
          </div>

          {status && (
            <div className="rounded-xl border border-white/[0.06] bg-surface-2/35 p-3">
              <ul
                aria-label={t("controles.vision.status.label")}
                className="flex flex-col gap-1.5 text-xs text-muted-foreground"
              >
                <li className="flex items-center gap-2">
                  <span
                    className={cn(
                      "inline-block h-2 w-2 rounded-full",
                      status.daemon_state === "running" ? "bg-emerald-500" : "bg-muted-foreground/40"
                    )}
                    aria-hidden="true"
                  />
                  <span>{t("controles.vision.status.daemon", { state: status.daemon_state })}</span>
                </li>
                <li className="flex items-center gap-2">
                  <span
                    className={cn(
                      "inline-block h-2 w-2 rounded-full",
                      status.model_installed ? "bg-emerald-500" : "bg-amber-500"
                    )}
                    aria-hidden="true"
                  />
                  <span>
                    {status.model_installed === false
                      ? t("controles.vision.status.modelMissing", { model: data?.model ?? "" })
                      : status.model_installed
                        ? t("controles.vision.status.modelOk")
                        : t("controles.vision.status.modelUnknown")}
                  </span>
                </li>
                <li className="flex items-center gap-2">
                  <span
                    className={cn(
                      "inline-block h-2 w-2 rounded-full",
                      status.capture_available ? "bg-emerald-500" : "bg-danger"
                    )}
                    aria-hidden="true"
                  />
                  <span>
                    {status.capture_available
                      ? t("controles.vision.status.captureOk")
                      : t("controles.vision.status.captureMissing")}
                  </span>
                </li>
              </ul>
            </div>
          )}
        </SectionBlock>
      </div>
    </Card>
  );
}
