import { useCallback, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { Card } from "../../ui/Card.js";
import { Alert } from "../../ui/Alert.js";
import { Badge } from "../../ui/Badge.js";
import { Segmented } from "../../ui/Segmented.js";
import { Select } from "../../ui/Select.js";
import { Switch } from "../../ui/Switch.js";
import { TTS_CONFIG_QUERY_KEY, useTtsConfigQuery, type TtsConfig } from "../../api/tts.js";
import { getTtsConfig, type EngineCommand } from "../../api/client.js";
import { useEngineCommand } from "../../api/engineCommand.js";
import { useT, type TKey } from "../../i18n/t.js";
import { VoiceCatalogSection } from "./VoiceCatalogSection.js";

// Piper speed presets mirrored from opencohost/ui/tts_speed_control.py::SPEED_PRESETS
// (length_scale — higher is slower). ponytail: keep in sync manually.
const SPEED_OPTIONS = [
  { value: "fast", labelKey: "controles.voice.speed.fast" },
  { value: "medium", labelKey: "controles.voice.speed.medium" },
  { value: "calm", labelKey: "controles.voice.speed.calm" },
  { value: "slow", labelKey: "controles.voice.speed.slow" }
] as const satisfies ReadonlyArray<{ value: string; labelKey: TKey }>;
export type SpeedOption = (typeof SPEED_OPTIONS)[number]["value"];
export const SPEED_SCALE: Record<SpeedOption, number> = { fast: 1.0, medium: 1.15, calm: 1.3, slow: 1.45 };
const LOCAL_ONLY_POLL_INTERVAL_MS = 250;
const LOCAL_ONLY_MAX_POLLS = 20;
const LOCAL_ONLY_CONVERGENCE_TIMEOUT_MS = 5000;

function waitForNextLocalOnlyPoll(signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", abort);
      resolve();
    }, LOCAL_ONLY_POLL_INTERVAL_MS);
    const abort = () => {
      clearTimeout(timer);
      reject(new DOMException("Aborted", "AbortError"));
    };
    signal.addEventListener("abort", abort, { once: true });
  });
}

export function closestSpeedOption(scale: number): SpeedOption {
  return (Object.entries(SPEED_SCALE) as [SpeedOption, number][]).reduce((closest, [option, value]) =>
    Math.abs(value - scale) < Math.abs(SPEED_SCALE[closest] - scale) ? option : closest
  , "fast" as SpeedOption);
}

// Motor TTS values mirrored from opencohost/ui/app_shell.py's switch
// (onvalue="ligero", offvalue="pesado") — "pesado" (heavy) is gated by
// heavy_available (EXPERIMENTAL_HEAVY_TTS_ENABLED).
const ENGINE_OPTIONS = [
  { id: "ligero", labelKey: "controles.voice.engine.light" },
  { id: "pesado", labelKey: "controles.voice.engine.heavy" }
] as const satisfies ReadonlyArray<{ id: string; labelKey: TKey }>;

type OptimisticTtsField = "speed" | "engine" | "discard_speech_residue";

/**
 * Coordinates one optimistic TTS setting with TTS_CONFIG_QUERY_KEY rollback:
 * snapshots the prior field value synchronously before writing cache, restores
 * it before clearing optimistic state on rejection/failure/timeout, and avoids
 * clobbering concurrent changes on sibling fields.
 */
function useOptimisticTtsField<K extends OptimisticTtsField, TUi = TtsConfig[K]>(
  field: K,
  commandName: EngineCommand,
  toConfigValue: (uiValue: TUi) => TtsConfig[K]
) {
  const queryClient = useQueryClient();
  const [optimistic, setOptimistic] = useState<TUi | null>(null);
  const lastConfirmedRef = useRef<{ value: TtsConfig[K] | undefined; snapshot: TtsConfig | undefined } | null>(null);

  const rollback = useCallback(() => {
    const saved = lastConfirmedRef.current;
    if (saved) {
      lastConfirmedRef.current = null;
      queryClient.setQueryData<TtsConfig>(TTS_CONFIG_QUERY_KEY, (old) => {
        if (!old) return saved.snapshot;
        if (saved.snapshot === undefined) return old;
        return { ...old, [field]: saved.value };
      });
    }
    setOptimistic(null);
  }, [field, queryClient]);

  const command = useEngineCommand<TtsConfig[K]>(undefined, {
    onError: rollback,
    onTimeout: rollback,
    onFailed: rollback
  });

  useEffect(() => {
    if (!command.pending) {
      if (command.isError || command.isTimeout || command.isFailed) {
        rollback();
      } else {
        lastConfirmedRef.current = null;
        setOptimistic(null);
      }
    }
  }, [command.pending, command.isError, command.isTimeout, command.isFailed, rollback]);

  function apply(uiValue: TUi) {
    const configValue = toConfigValue(uiValue);
    const snapshot = queryClient.getQueryData<TtsConfig>(TTS_CONFIG_QUERY_KEY);
    lastConfirmedRef.current = { value: snapshot?.[field], snapshot };
    setOptimistic(uiValue);
    void queryClient.cancelQueries({ queryKey: TTS_CONFIG_QUERY_KEY });
    queryClient.setQueryData<TtsConfig>(TTS_CONFIG_QUERY_KEY, (old) =>
      old ? { ...old, [field]: configValue } : old
    );
    void command.run(commandName, configValue);
  }

  return { optimistic, command, apply };
}

/**
 * Voz de Kira card — idioma, modo local, velocidad, motor TTS, all wired to
 * the real backend (GET /api/tts/config; POST /api/commands set_piper_voice /
 * set_tts_local_only / set_tts_speed / set_motor_tts via useEngineCommand).
 * Each control owns its own useEngineCommand instance so exactly one
 * disables while it applies. Displayed value = optimistic local pick while
 * pending, falling back to server truth once the command converges — same
 * pattern as ModelCard/ProfileSwitcher.
 */
export function VoiceCard() {
  const t = useT();
  const queryClient = useQueryClient();
  const { data, isError: configError } = useTtsConfigQuery();
  const localOnlyCommand = useEngineCommand<boolean>(undefined, { manualConvergence: true });
  const speedField = useOptimisticTtsField("speed", "set_tts_speed", (v: SpeedOption) => SPEED_SCALE[v]);
  const engineField = useOptimisticTtsField("engine", "set_motor_tts", (v: string) => v);
  const discardResidueField = useOptimisticTtsField(
    "discard_speech_residue",
    "set_discard_speech_residue",
    (v: boolean) => v
  );
  const [localOnlyOperation, setLocalOnlyOperation] = useState<
    { value: boolean; status: "applying" | "saved" | "error"; message?: string } | null
  >(null);
  const [voicePending, setVoicePending] = useState(false);
  const localOnlyController = useRef<AbortController | null>(null);
  const localOnlyRunning = useRef(false);

  useEffect(() => () => localOnlyController.current?.abort(), []);

  const localOnly = localOnlyOperation?.status === "applying" ? localOnlyOperation.value : data?.local_only ?? true;
  const speed = speedField.optimistic ?? (data ? closestSpeedOption(data.speed) : "medium");
  const engine = engineField.optimistic ?? data?.engine ?? ENGINE_OPTIONS[0].id;
  const discardResidue = discardResidueField.optimistic ?? data?.discard_speech_residue ?? false;
  const pending =
    voicePending ||
    (localOnlyOperation?.status === "applying" || localOnlyCommand.pending) ||
    speedField.command.pending ||
    engineField.command.pending ||
    discardResidueField.command.pending;
  const commandTimeout =
    speedField.command.isTimeout ||
    engineField.command.isTimeout ||
    discardResidueField.command.isTimeout;
  const commandFailed =
    speedField.command.isFailed ||
    engineField.command.isFailed ||
    discardResidueField.command.isFailed;
  const errorMessage =
    speedField.command.error?.message ??
    engineField.command.error?.message ??
    discardResidueField.command.error?.message ??
    (commandTimeout ? t("controles.voice.localOnly.error.timeout") : undefined) ??
    (commandFailed ? t("controles.voice.error.applyFailed") : undefined);

  async function applyLocalOnly(value: boolean) {
    if (localOnlyRunning.current) return;
    localOnlyRunning.current = true;
    localOnlyController.current?.abort();
    const controller = new AbortController();
    localOnlyController.current = controller;
    setLocalOnlyOperation({ value, status: "applying" });

    let lastConfirmedConfig = queryClient.getQueryData<TtsConfig>(TTS_CONFIG_QUERY_KEY);
    let timeoutController: AbortController | null = null;
    let timeoutTimer: ReturnType<typeof setTimeout> | null = null;
    async function settleTimeout() {
      if (controller.signal.aborted || !timeoutController?.signal.aborted) return;
      await queryClient.cancelQueries({ queryKey: TTS_CONFIG_QUERY_KEY });
      if (controller.signal.aborted) return;
      if (lastConfirmedConfig) queryClient.setQueryData(TTS_CONFIG_QUERY_KEY, lastConfirmedConfig);
      localOnlyCommand.stopWaiting();
      setLocalOnlyOperation({ value, status: "error", message: t("controles.voice.localOnly.error.timeout") });
    }

    try {
      // Cancel the initial/background config request before the accepted
      // command. The manual query below is no-store and starts only afterward.
      await queryClient.cancelQueries({ queryKey: TTS_CONFIG_QUERY_KEY });
      const accepted = await localOnlyCommand.run("set_tts_local_only", value);
      if (!accepted) throw new Error("request");
      timeoutController = new AbortController();
      timeoutTimer = setTimeout(() => timeoutController?.abort(), LOCAL_ONLY_CONVERGENCE_TIMEOUT_MS);
      const pollSignal = AbortSignal.any([controller.signal, timeoutController.signal]);

      for (let attempt = 0; attempt < LOCAL_ONLY_MAX_POLLS; attempt += 1) {
        if (attempt > 0) await waitForNextLocalOnlyPoll(pollSignal);
        if (controller.signal.aborted) return;
        if (timeoutController.signal.aborted) {
          await settleTimeout();
          return;
        }
        let config: TtsConfig;
        try {
          config = await getTtsConfig({ signal: pollSignal });
        } catch (error) {
          if (controller.signal.aborted) return;
          if (timeoutController.signal.aborted) {
            await settleTimeout();
            return;
          }
          await queryClient.cancelQueries({ queryKey: TTS_CONFIG_QUERY_KEY });
          if (lastConfirmedConfig) queryClient.setQueryData(TTS_CONFIG_QUERY_KEY, lastConfirmedConfig);
          setLocalOnlyOperation({ value, status: "error", message: t("controles.voice.localOnly.error.read") });
          localOnlyCommand.stopWaiting();
          return;
        }
        if (controller.signal.aborted) return;
        if (timeoutController.signal.aborted) {
          await settleTimeout();
          return;
        }
        if (config.local_only === value) {
          await queryClient.cancelQueries({ queryKey: TTS_CONFIG_QUERY_KEY });
          if (controller.signal.aborted) return;
          if (timeoutController.signal.aborted) {
            await settleTimeout();
            return;
          }
          queryClient.setQueryData(TTS_CONFIG_QUERY_KEY, config);
          localOnlyCommand.confirmApplied("set_tts_local_only", value);
          setLocalOnlyOperation({ value, status: "saved", message: t("controles.voice.localOnly.saved") });
          return;
        }
        lastConfirmedConfig = config;
      }

      timeoutController.abort();
      await settleTimeout();
    } catch {
      if (controller.signal.aborted) return;
      if (timeoutController?.signal.aborted) {
        await settleTimeout();
        return;
      }
      localOnlyCommand.stopWaiting();
      setLocalOnlyOperation({ value, status: "error", message: t("controles.voice.localOnly.error.request") });
    } finally {
      if (timeoutTimer) clearTimeout(timeoutTimer);
      if (localOnlyController.current === controller) {
        localOnlyController.current = null;
        localOnlyRunning.current = false;
      }
    }
  }

  return (
    <Card className="flex flex-col p-4">
      <div className="flex items-center justify-between gap-3 border-b border-border-soft pb-3">
        <h2 className="text-sm font-bold text-foreground">{t("controles.voice.card.title")}</h2>
        {pending && (
          <Badge tone="info">
            <Loader2 size={12} className="animate-spin motion-reduce:animate-none" aria-hidden="true" />
            {t("controles.voice.card.pending")}
          </Badge>
        )}
      </div>

      <div className="flex flex-col gap-3.5 pt-3.5">
        {(errorMessage || configError) && (
          <p role="alert" className="text-xs leading-relaxed text-danger">
            {errorMessage ?? t("controles.voice.error.load")}
          </p>
        )}

        {localOnlyOperation && (
          <p
            role={localOnlyOperation.status === "error" ? "alert" : "status"}
            aria-live={localOnlyOperation.status === "error" ? "assertive" : "polite"}
            className={
              localOnlyOperation.status === "error"
                ? "text-xs leading-relaxed text-danger"
                : "inline-flex items-center gap-1.5 text-xs leading-relaxed text-muted-foreground"
            }
          >
            {localOnlyOperation.status === "applying" && (
              <Loader2 size={12} className="shrink-0 animate-spin text-info motion-reduce:animate-none" aria-hidden="true" />
            )}
            {localOnlyOperation.status === "applying"
              ? t("controles.voice.localOnly.applying")
              : localOnlyOperation.message}
          </p>
        )}

        {data?.local_only && data?.piper_available === false && (
          <Alert tone="warn" title={t("controles.voice.alert.piperUnavailable.title")}>
            {data.piper_unavailable_reason === "voice_file_missing"
              ? t("controles.voice.alert.piperUnavailable.voiceFileMissing")
              : t("controles.voice.alert.piperUnavailable.body")}
          </Alert>
        )}

        {!data?.local_only && data?.edge_tts_offline && (
          <Alert tone="info" title={t("controles.voice.alert.edgeOffline.title")}>
            {t("controles.voice.alert.edgeOffline.body")}
          </Alert>
        )}

        <VoiceCatalogSection config={data} onPendingChange={setVoicePending} />

        <div className="grid grid-cols-[1fr_auto] items-center gap-3">
          <span className="text-[13px] text-foreground">{t("controles.voice.localOnly")}</span>
          <Switch
            checked={localOnly}
            disabled={localOnlyOperation?.status === "applying" || localOnlyCommand.pending}
            onChange={(checked) => applyLocalOnly(checked)}
            aria-label={t("controles.voice.localOnly")}
          />
        </div>

        <div className="grid grid-cols-[1fr_auto] items-center gap-3">
          <div className="flex flex-col gap-0.5">
            <span className="text-[13px] text-foreground">{t("controles.voice.discardResidue")}</span>
            <span className="text-[11px] leading-tight text-dim">{t("controles.voice.discardResidue.hint")}</span>
            {discardResidueField.command.pending && (
              <span role="status" className="inline-flex items-center gap-1.5 text-xs text-info">
                <Loader2 size={12} className="animate-spin motion-reduce:animate-none" aria-hidden="true" />
                {t("controles.voice.applying.discardResidue")}
              </span>
            )}
          </div>
          <Switch
            checked={discardResidue}
            disabled={discardResidueField.command.pending}
            onChange={(checked) => discardResidueField.apply(checked)}
            aria-label={t("controles.voice.discardResidue")}
          />
        </div>

        <section aria-labelledby="speed-label" className="space-y-1.5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span id="speed-label" className="text-[11px] font-semibold uppercase tracking-[0.09em] text-dim">
              {t("controles.voice.speed.eyebrow")}
            </span>
            <Segmented
              options={SPEED_OPTIONS.map((option) => ({ value: option.value, label: t(option.labelKey) }))}
              value={speed}
              className="flex items-center gap-1.5 align-center justify-end"
              disabled={speedField.command.pending}
              pending={speedField.command.pending}
              onChange={(value) => speedField.apply(value)}
              ariaLabel={t("controles.voice.speed.aria")}
            />
          </div>
          {speedField.command.pending && (
            <p role="status" className="inline-flex items-center gap-1.5 text-xs text-info">
              <Loader2 size={12} className="animate-spin motion-reduce:animate-none" aria-hidden="true" />
              <span>{t("controles.voice.applying.speed")}</span>
            </p>
          )}
        </section>

        <section aria-labelledby="engine-select-label" className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <span id="engine-select-label" className="text-[11px] font-semibold uppercase tracking-[0.09em] text-dim">
              {t("controles.voice.engineSelect")}
            </span>
            {engineField.command.pending && (
              <span role="status" className="inline-flex items-center gap-1.5 text-xs text-info">
                <Loader2 size={12} className="animate-spin motion-reduce:animate-none" aria-hidden="true" />
                {t("controles.voice.applying.engine")}
              </span>
            )}
          </div>
          <Select
            aria-label={t("controles.voice.engineSelect")}
            value={engine}
            disabled={engineField.command.pending}
            loading={engineField.command.pending}
            options={ENGINE_OPTIONS.map((option) => ({
              value: option.id,
              label: t(option.labelKey),
              disabled: option.id === "pesado" && !data?.heavy_available
            }))}
            onChange={engineField.apply}
          />
        </section>

        <p className="text-xs leading-relaxed text-muted-foreground">
          {localOnly ? t("controles.voice.mode.local") : t("controles.voice.mode.cloud")}
        </p>
        <p className="text-xs leading-relaxed text-dim">
          {t("controles.voice.referenceVoice.hint.prefix")}{" "}
          <span className="mono">EXPERIMENTAL_HEAVY_TTS_ENABLED</span>
          {t("controles.voice.referenceVoice.hint.suffix")}
        </p>
      </div>
    </Card>
  );
}
