import { useState, type Dispatch, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Cloud, Cpu, ExternalLink, HardDrive, Loader2, MonitorSmartphone, RefreshCw } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import {
  getIdempotencyKey,
  postCommand,
  rotateIdempotencyKey,
  type LlmReadinessResponse
} from "../../api/client.js";
import { getI18nState, putI18nLocale } from "../../api/i18n.js";
import { useSetupStateQuery } from "../../api/setup.js";
import { TTS_CONFIG_QUERY_KEY } from "../../api/tts.js";
import { Alert } from "../../ui/Alert.js";
import { Badge, type BadgeTone } from "../../ui/Badge.js";
import { Button } from "../../ui/Button.js";
import { useT, type TKey } from "../../i18n/t.js";
import { UI_LOCALES, useUiLocale, type UiLocale } from "../../i18n/locale.js";
import { cn } from "../../lib/cn.js";
import { RestartToApply } from "../shared/RestartToApply.js";
import type { CatalogEntryLike, EngineChoice, HardwareFacts, SetupEvent, SetupMachineState, SetupStep } from "./setupMachine.js";

export interface StepProps {
  state: SetupMachineState;
  dispatch: Dispatch<SetupEvent>;
}

export type LocalOllamaAvailability = "ready" | "missing" | "offline" | "unknown";

/** Cloud readiness can omit local probes; unreachable alone does not mean missing. */
export function localOllamaAvailability(readiness: LlmReadinessResponse | undefined): LocalOllamaAvailability {
  if (readiness?.ollama?.reachable) return "ready";
  if (readiness?.ollama?.binary_found === true || readiness?.state === "LOCAL_OLLAMA_OFFLINE") return "offline";
  if (readiness?.ollama?.binary_found === false || readiness?.state === "LOCAL_OLLAMA_MISSING") return "missing";
  return "unknown";
}

// ─── Language + Kira language + narrator ────────────────────────────────────

const LOCALE_LABEL: Record<UiLocale, TKey> = { es: "setup.language.es", en: "setup.language.en" };

function normalizeUiLocale(raw: string | undefined | null): UiLocale | null {
  if (!raw) return null;
  const lower = raw.trim().toLowerCase();
  if (lower.startsWith("en")) return "en";
  if (lower.startsWith("es")) return "es";
  return null;
}

/**
 * First screen, one decision: the UI interface language. Applies at once
 * without touching the backend locale or requiring a restart.
 */
export function LanguageStep() {
  const t = useT();
  const { locale, setLocale } = useUiLocale();

  return (
    <div className="flex flex-col gap-3">
      <p className="max-w-xl text-sm leading-relaxed text-muted-foreground">{t("setup.language.uiHint")}</p>
      <div role="group" aria-label={t("setup.language.title")} className="flex flex-wrap gap-3">
        {UI_LOCALES.map((code) => (
          <ChoiceCard
            key={code}
            pressed={locale === code}
            onSelect={() => setLocale(code)}
            title={t(LOCALE_LABEL[code])}
          />
        ))}
      </div>
    </div>
  );
}

export interface KiraLanguageStepProps {
  /** Called before RestartToApply triggers reloadBackend() so progress resumes past the language block. */
  onBeforeRestart?: () => Promise<void> | void;
}

/**
 * Second screen, one decision: the language Kira speaks. Persists the backend
 * locale via PUT /api/i18n and offers RestartToApply immediately whenever
 * `pending_restart` is true. A failed save never blocks the wizard.
 */
export function KiraLanguageStep({ onBeforeRestart }: KiraLanguageStepProps) {
  const t = useT();
  const queryClient = useQueryClient();
  const { locale } = useUiLocale();
  const { data: i18nState } = useQuery({ queryKey: ["i18n"], queryFn: getI18nState, staleTime: 5_000 });
  const [selected, setSelected] = useState<UiLocale | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(false);

  const activeChoice =
    selected ??
    normalizeUiLocale(i18nState?.persisted_locale) ??
    normalizeUiLocale(i18nState?.active_locale) ??
    locale;
  const pendingRestart = i18nState?.pending_restart === true;

  async function choose(code: UiLocale) {
    setSelected(code);
    setSaveError(false);
    setSaving(true);
    try {
      await queryClient.cancelQueries({ queryKey: ["i18n"] });
      const next = await putI18nLocale(code);
      queryClient.setQueryData(["i18n"], next);
      // Best-effort sync of Piper voice with Kira's speech language so the duplicate
      // voice-choice screen is unnecessary. Never fail or block if engine is unavailable.
      const piperVoice = code === "en" ? "english" : "neutral";
      const intentKey = `set_piper_voice:${piperVoice}`;
      void postCommand("set_piper_voice", piperVoice, getIdempotencyKey(intentKey))
        .then(() => {
          rotateIdempotencyKey(intentKey);
          void queryClient.invalidateQueries({ queryKey: TTS_CONFIG_QUERY_KEY });
        })
        .catch(() => undefined);
    } catch {
      setSelected(null);
      setSaveError(true);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="max-w-xl text-sm leading-relaxed text-muted-foreground">{t("setup.language.kiraHint")}</p>
      <div role="group" aria-label={t("setup.kiraLanguage.title")} className="flex flex-wrap gap-3">
        {UI_LOCALES.map((code) => (
          <ChoiceCard
            key={code}
            pressed={activeChoice === code}
            disabled={saving}
            onSelect={() => void choose(code)}
            title={t(LOCALE_LABEL[code])}
          />
        ))}
      </div>
      {saving && (
        <p role="status" className="text-xs leading-relaxed text-muted-foreground">{t("setup.language.kiraSaving")}</p>
      )}
      {pendingRestart && (
        <RestartToApply notice="setup.language.kiraPending" onBeforeRestart={onBeforeRestart} />
      )}
      {saveError && <Alert tone="warn" role="status">{t("setup.language.kiraError")}</Alert>}
    </div>
  );
}

export interface NarratorStepProps {
  /** null until the user answers "do you want to hear Kira?". */
  hearKira: boolean | null;
  onHearKira(hear: boolean): void;
}

const NARRATOR_BTN_CLASS =
  "aria-[pressed=true]:border-primary aria-[pressed=true]:bg-accent-soft aria-[pressed=true]:text-primary";

/** Third screen, one decision: whether Kira speaks while she guides. Preselected from a stored choice. */
export function NarratorStep({ hearKira, onHearKira }: NarratorStepProps) {
  const t = useT();
  return (
    <div className="flex flex-col gap-2.5">
      <p className="text-base font-semibold text-foreground">{t("setup.language.hearQuestion")}</p>
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          aria-pressed={hearKira === true}
          onClick={() => onHearKira(true)}
          className={NARRATOR_BTN_CLASS}
        >
          {hearKira === true && <Check size={14} className="shrink-0 text-primary" aria-hidden="true" />}
          {t("setup.language.hearYes")}
        </Button>
        <Button
          type="button"
          variant="outline"
          aria-pressed={hearKira === false}
          onClick={() => onHearKira(false)}
          className={NARRATOR_BTN_CLASS}
        >
          {hearKira === false && <Check size={14} className="shrink-0 text-primary" aria-hidden="true" />}
          {t("setup.language.hearNo")}
        </Button>
      </div>
      <p className="text-xs leading-relaxed text-muted-foreground">{t("setup.language.hearHint")}</p>
    </div>
  );
}

// ─── Welcome ────────────────────────────────────────────────────────────────

const WELCOME_ITEMS: readonly TKey[] = [
  "setup.welcome.item.hardware",
  "setup.welcome.item.brain",
  "setup.welcome.item.test",
  "setup.welcome.item.personalize"
];

export function WelcomeStep() {
  const t = useT();
  const legacyInstall = Boolean(useSetupStateQuery().data?.legacy_install);
  return (
    <div className="flex max-w-xl flex-col gap-4">
      {legacyInstall ? <p className="text-sm leading-relaxed text-muted-foreground">{t("setup.welcome.freshStart")}</p> : null}
      <ul aria-label={t("setup.welcome.listAria")} className="flex flex-col gap-2">
        {WELCOME_ITEMS.map((key) => (
          <li key={key} className="flex gap-3 rounded-md border border-border-soft bg-surface-2 px-3.5 py-2.5 text-sm leading-relaxed text-foreground">
            <Check size={15} className="mt-0.5 shrink-0 text-primary" aria-hidden="true" />
            <span>{t(key)}</span>
          </li>
        ))}
      </ul>
      <p className="text-sm font-medium leading-relaxed text-muted-foreground">{t("setup.welcome.once")}</p>
    </div>
  );
}

// ─── Hardware ───────────────────────────────────────────────────────────────

function DiagRow({ icon: Icon, label, value, badge, tone }: { icon: LucideIcon; label: string; value: string; badge: string; tone: BadgeTone }) {
  return (
    <li className="flex flex-wrap items-center gap-3 rounded-md border border-border-soft bg-surface-2 px-3.5 py-3">
      <Icon size={16} className="shrink-0 text-dim" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p className="text-[11px] font-semibold uppercase tracking-[0.09em] text-dim">{label}</p>
        <p className="truncate text-sm font-semibold text-foreground">{value}</p>
      </div>
      <Badge tone={tone}>{badge}</Badge>
    </li>
  );
}

export interface HardwareStepProps {
  readiness: LlmReadinessResponse | undefined;
  hardware: HardwareFacts | null;
  isError: boolean;
  isFetching: boolean;
  onRecheck(): void;
  catalog: Record<string, CatalogEntryLike>;
}

export function HardwareStep({ readiness, hardware, isError, isFetching, onRecheck, catalog }: HardwareStepProps) {
  const t = useT();

  const recheck = (
    <Button type="button" variant="outline" disabled={isFetching} onClick={onRecheck} className="self-start">
      <RefreshCw size={14} aria-hidden="true" />
      {isFetching ? t("setup.hardware.rechecking") : t("setup.hardware.recheck")}
    </Button>
  );

  if (!readiness || !hardware) {
    return (
      <div className="flex flex-col gap-3" aria-live="polite">
        {isError ? <Alert tone="warn">{t("setup.hardware.error")}</Alert> : <p className="text-sm text-muted-foreground">{t("setup.hardware.loading")}</p>}
        {isError && recheck}
      </div>
    );
  }

  const isCloud = readiness.provider === "cloud";
  const availability = localOllamaAvailability(readiness);
  const ollama = isCloud && availability === "unknown"
    ? { value: t("setup.hardware.ollama.cloud"), badge: t("setup.hardware.badge.cloud"), tone: "info" as const }
    : availability === "ready"
      ? { value: t("setup.hardware.ollama.ok"), badge: t("setup.hardware.badge.ready"), tone: "ok" as const }
      : {
          value: t(
            availability === "offline" ? "setup.hardware.ollama.offline" :
              availability === "missing" ? "setup.hardware.ollama.missing" : "setup.hardware.ollama.unknown"
          ),
          badge: t(availability === "unknown" ? "setup.hardware.badge.unknown" : "setup.engine.unavailable"),
          tone: "warn" as const
        };
  const installed = readiness.ollama?.installed_models ?? [];
  const installedNames = installed.map((tag) => catalog[tag]?.display ?? tag).join(", ");

  return (
    <div className="flex flex-col gap-4" aria-live="polite">
      <ul className="flex flex-col gap-2">
        <DiagRow
          icon={Cpu}
          label={t("setup.hardware.gpu.label")}
          value={
            hardware.hasGpu
              ? t("setup.hardware.gpu.value", { gpu: hardware.gpuName ?? "GPU", vram: hardware.vramGb })
              : t("setup.hardware.gpu.none")
          }
          badge={
            hardware.hasGpu
              ? hardware.vramGb >= 8
                ? t("setup.hardware.gpu.great")
                : t("setup.hardware.gpu.enough")
              : t("setup.hardware.gpu.cpuOnly")
          }
          tone={hardware.hasGpu ? "ok" : "warn"}
        />
        <DiagRow icon={MonitorSmartphone} label={t("setup.hardware.ollama.label")} value={ollama.value} badge={ollama.badge} tone={ollama.tone} />
        {!isCloud && (
          <DiagRow
            icon={HardDrive}
            label={t("setup.hardware.models.label")}
            value={installed.length > 0 ? installedNames : t("setup.hardware.models.none")}
            badge={String(installed.length)}
            tone={installed.length > 0 ? "ok" : "neutral"}
          />
        )}
      </ul>

      {!isCloud && availability !== "ready" && (
        <div className="flex flex-col gap-3 rounded-md border border-border-soft bg-card p-3.5">
          <p className="text-sm leading-relaxed text-foreground">
            {t(availability === "missing" ? "setup.hardware.ollamaHelp" : `setup.engine.ollama.${availability}`)}
          </p>
          <div className="flex flex-wrap items-center gap-3">
            {availability === "missing" && (
              <OllamaDownloadLink />
            )}
            {recheck}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Engine ─────────────────────────────────────────────────────────────────

/** A large selectable card. Toggle-button semantics: one pressed at a time within its group. */
export function ChoiceCard({
  pressed,
  disabled,
  pending = false,
  onSelect,
  title,
  badge,
  badgeTone = "neutral",
  children,
  icon: Icon
}: {
  pressed: boolean;
  disabled?: boolean;
  pending?: boolean;
  onSelect(): void;
  title: string;
  badge?: string | null;
  badgeTone?: BadgeTone;
  children?: ReactNode;
  icon?: LucideIcon;
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      aria-busy={pending || undefined}
      disabled={disabled}
      onClick={onSelect}
      className={cn(
        "flex w-full flex-col items-start gap-2 rounded-lg border-2 p-4 text-left transition-colors duration-fast ease-io",
        "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
        disabled
          ? "cursor-not-allowed border-border-soft bg-surface-2 opacity-60"
          : pressed
            ? "border-primary bg-accent-soft"
            : "border-border-soft bg-surface-2 hover:border-border"
      )}
    >
      <span className="flex w-full flex-wrap items-center gap-2">
        {Icon && <Icon size={16} className="text-primary" aria-hidden="true" />}
        <span className="text-sm font-bold text-foreground">{title}</span>
        {pressed && pending ? (
          <Loader2 size={15} className="animate-spin text-primary motion-reduce:animate-none" aria-hidden="true" />
        ) : (
          pressed && <Check size={15} className="text-primary" aria-hidden="true" />
        )}
        {badge && <Badge tone={badgeTone} className="ml-auto px-2 py-0.5 text-[11px]">{badge}</Badge>}
      </span>
      {children}
    </button>
  );
}

/** The "Descargar Ollama" link, shared by the hardware and engine steps. */
export function OllamaDownloadLink() {
  const t = useT();
  return (
    <a
      href="https://ollama.com/download"
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-1.5 rounded-md text-sm font-semibold text-primary hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
    >
      {t("setup.hardware.download")} <ExternalLink size={13} aria-hidden="true" />
    </a>
  );
}

export function EngineStep({
  state,
  dispatch,
  labelledBy,
  gpuRecommendedName,
  ollamaAvailability,
  onRecheck,
  isFetching = false
}: StepProps & {
  labelledBy: string;
  gpuRecommendedName: string | null;
  ollamaAvailability: LocalOllamaAvailability;
  /** Re-reads the Ollama state; the engine step shows it only while Ollama is missing or off. */
  onRecheck?(): void;
  isFetching?: boolean;
}) {
  const t = useT();
  const localUnavailable = ollamaAvailability === "missing" || ollamaAvailability === "offline";
  // Without a working Ollama the only engine that can work is the cloud one: nudge toward it.
  const recommended: EngineChoice | null = localUnavailable
    ? "cloud"
    : ollamaAvailability === "ready"
      ? state.hasGpu ? "gpu" : "cpu"
      : null;
  const options: ReadonlyArray<{ id: EngineChoice; icon: LucideIcon; title: TKey; desc: TKey; note: string; disabled: boolean }> = [
    {
      id: "gpu",
      icon: Cpu,
      title: "setup.engine.gpu.title",
      desc: "setup.engine.gpu.desc",
      note: state.hasGpu
        ? gpuRecommendedName
          ? t("setup.engine.gpu.note", { model: gpuRecommendedName })
          : ""
        : t("setup.engine.gpu.noGpu"),
      disabled: !state.hasGpu || localUnavailable
    },
    { id: "cpu", icon: HardDrive, title: "setup.engine.cpu.title", desc: "setup.engine.cpu.desc", note: t("setup.engine.cpu.note"), disabled: localUnavailable },
    { id: "cloud", icon: Cloud, title: "setup.engine.cloud.title", desc: "setup.engine.cloud.desc", note: t("setup.engine.cloud.note"), disabled: false }
  ];

  return (
    <div className="flex flex-col gap-3">
      {ollamaAvailability !== "ready" && (
        <Alert role="status" tone={localUnavailable ? "warn" : "info"}>
          <span className="flex flex-col gap-2">
            {ollamaAvailability === "missing" && <span>{t("setup.engine.ollama.what")}</span>}
            <span>{t(`setup.engine.ollama.${ollamaAvailability}`)}</span>
            {localUnavailable && <span className="font-semibold">{t("setup.engine.ollama.apiKeyHint")}</span>}
          </span>
        </Alert>
      )}
      {localUnavailable && (
        <div className="flex flex-wrap items-center gap-3">
          {ollamaAvailability === "missing" && <OllamaDownloadLink />}
          {onRecheck && (
            <Button type="button" variant="outline" disabled={isFetching} onClick={onRecheck}>
              <RefreshCw size={14} aria-hidden="true" />
              {isFetching ? t("setup.hardware.rechecking") : t("setup.hardware.recheck")}
            </Button>
          )}
        </div>
      )}
      <div role="group" aria-labelledby={labelledBy} className="grid gap-3 sm:grid-cols-3">
        {options.map((option) => (
          <ChoiceCard
            key={option.id}
            icon={option.icon}
            pressed={state.engine === option.id}
            disabled={option.disabled}
            onSelect={() => dispatch({ type: "chooseEngine", engine: option.id })}
            title={t(option.title)}
            badge={option.disabled ? t("setup.engine.unavailable") : option.id === recommended ? t("setup.engine.recommended") : null}
            badgeTone={option.disabled ? "neutral" : "ok"}
          >
            <span className="text-sm leading-relaxed text-muted-foreground">{t(option.desc)}</span>
            {option.note && <span className="text-xs leading-relaxed text-dim">{option.note}</span>}
          </ChoiceCard>
        ))}
      </div>
    </div>
  );
}

// ─── Done ───────────────────────────────────────────────────────────────────

export const ENGINE_TITLE: Record<EngineChoice, TKey> = {
  gpu: "setup.engine.gpu.title",
  cpu: "setup.engine.cpu.title",
  cloud: "setup.engine.cloud.title"
};

const VERDICT_TEXT: Record<"passed" | "slow" | "failed", TKey> = {
  passed: "setup.test.verdict.passed",
  slow: "setup.test.verdict.slow",
  failed: "setup.test.verdict.failed"
};

// The former welcome slides, kept as "what I can do" (owner decision).
const CAPABILITIES: ReadonlyArray<{ title: TKey; copy: TKey }> = [
  { title: "experiencia.welcomeCard.slide1.title", copy: "experiencia.welcomeCard.slide1.copy" },
  { title: "experiencia.welcomeCard.slide2.title", copy: "experiencia.welcomeCard.slide2.copy" },
  { title: "experiencia.welcomeCard.slide3.title", copy: "experiencia.welcomeCard.slide3.copy" },
  { title: "experiencia.welcomeCard.slide4.title", copy: "experiencia.welcomeCard.slide4.copy" },
  { title: "experiencia.welcomeCard.slide5.title", copy: "experiencia.welcomeCard.slide5.copy" }
];

export interface DoneStepProps {
  state: SetupMachineState;
  /** Display name of the chosen model (catalog name, raw tag, or the cloud model). */
  modelName: string | null;
  /** "Cambiar": jump back to a step; the machine returns straight to done afterwards. */
  onEdit(step: SetupStep): void;
  /** Current voice setting (e.g. "Piper"), shown when the voice was not answered in this run. */
  voiceSummary?: string | null;
}

export function DoneStep({ state, modelName, onEdit, voiceSummary = null }: DoneStepProps) {
  const t = useT();
  const rows: Array<{ label: TKey; value: string; step: SetupStep }> = [
    { label: "setup.done.summary.engine", value: state.engine ? t(ENGINE_TITLE[state.engine]) : "—", step: "engine" },
    { label: "setup.done.summary.model", value: modelName ?? "—", step: state.engine === "cloud" ? "apiKey" : "model" },
    {
      label: "setup.done.summary.voice",
      value:
        state.voice === "off"
          ? t("setup.done.voice.off")
          : state.voice === "ok"
            ? t("setup.done.voice.ok")
            : voiceSummary ?? "—",
      step: "voice"
    },
    { label: "setup.done.summary.test", value: state.testVerdict ? t(VERDICT_TEXT[state.testVerdict]) : "—", step: "test" },
    {
      label: "setup.done.summary.personalize",
      value: state.personalize ? t("setup.done.personalize.yes") : t("setup.done.personalize.no"),
      step: "personalize"
    }
  ];

  return (
    <div className="flex flex-col gap-6">
      <ul aria-label={t("setup.done.summary.aria")} className="grid gap-2 sm:grid-cols-2">
        {rows.map((row) => (
          <li key={row.label} className="flex items-center gap-3 rounded-md border border-border-soft bg-surface-2 px-3.5 py-2.5">
            <div className="min-w-0 flex-1">
              <p className="text-[11px] font-semibold uppercase tracking-[0.09em] text-dim">{t(row.label)}</p>
              <p className="truncate text-sm font-semibold text-foreground">{row.value}</p>
            </div>
            <Button
              type="button"
              variant="ghost"
              aria-label={t("setup.done.change.aria", { item: t(row.label) })}
              onClick={() => onEdit(row.step)}
              className="h-8 shrink-0 px-2.5 text-xs"
            >
              {t("setup.done.change")}
            </Button>
          </li>
        ))}
      </ul>

      <section aria-labelledby="setup-capabilities" className="flex flex-col gap-3">
        <h3 id="setup-capabilities" className="text-sm font-bold text-foreground">
          {t("setup.done.capabilities")}
        </h3>
        <ul className="grid gap-2.5 sm:grid-cols-2">
          {CAPABILITIES.map((item) => (
            <li key={item.title} className="flex gap-3 rounded-md border border-border-soft bg-card p-3">
              <span className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full bg-accent-soft text-primary">
                <Check size={14} aria-hidden="true" />
              </span>
              <span className="flex flex-col gap-0.5">
                <span className="text-sm font-semibold text-foreground">{t(item.title)}</span>
                <span className="text-xs leading-relaxed text-muted-foreground">{t(item.copy)}</span>
              </span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
