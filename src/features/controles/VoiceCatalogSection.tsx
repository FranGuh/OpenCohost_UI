import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AudioLines, Users } from "lucide-react";
import { Button } from "../../ui/Button.js";
import { Select, type SelectOption } from "../../ui/Select.js";
import { getI18nState } from "../../api/i18n.js";
import { primaryLocale } from "../../api/profiles.js";
import type { EngineCommand, PiperVoiceCommandValue } from "../../api/client.js";
import { useEngineCommand } from "../../api/engineCommand.js";
import {
  TTS_CONFIG_QUERY_KEY,
  useEdgeVoicesQuery,
  usePiperVoicesQuery,
  type PiperVoice,
  type TtsConfig
} from "../../api/tts.js";
import { useUiLocale } from "../../i18n/locale.js";
import { useT, type TKey } from "../../i18n/t.js";
import { PiperFolderRow } from "./PiperFolderRow.js";

const CONVERGENCE_POLL_MS = 500;
const PIPER_FAILURE_REASONS: readonly string[] = [
  "invalid_voice_id",
  "voice_not_found",
  "invalid_speaker_id",
  "speaker_out_of_range",
  "load_failed",
  "piper_unavailable"
];
const EDGE_FAILURE_REASONS: readonly string[] = ["invalid_edge_voice", "edge_voice_unknown", "config_write_failed"];

const LABEL_CLASS = "inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.09em] text-dim";

function failureKey(prefix: "piper" | "edge", reason: string | null | undefined): TKey {
  const known = prefix === "piper" ? PIPER_FAILURE_REASONS : EDGE_FAILURE_REASONS;
  const code = reason && known.includes(reason) ? reason : "unknown";
  return `controles.voice.${prefix}.failure.${code}` as TKey;
}

const piperMatches = (cfg: TtsConfig, v: PiperVoiceCommandValue) =>
  (cfg.piper_voice_id ?? cfg.piper_voice) === v.value &&
  (v.speaker_id === undefined || (cfg.piper_speaker_id ?? 0) === v.speaker_id);
const edgeMatches = (cfg: TtsConfig, v: string) => cfg.edge_voice === v;

/**
 * One voice/speaker switch with accepted != applied convergence: the command
 * stays pending until GET /api/tts/config reports the requested value (polled
 * while pending), a `*_voice_switch_failed` event clears it at once, and the
 * 15s ceiling of useEngineCommand ends a stuck wait. `target` is what the user
 * asked for; the shown value falls back to server truth the moment it clears.
 */
function useVoiceSwitch<V>(
  commandName: EngineCommand,
  config: TtsConfig | undefined,
  matches: (config: TtsConfig, value: V) => boolean
) {
  const queryClient = useQueryClient();
  const command = useEngineCommand<V>(undefined, { manualConvergence: true });
  const [target, setTarget] = useState<V | null>(null);
  const { pending, isFailed, isTimeout, confirmApplied } = command;

  useEffect(() => {
    if (pending && target !== null && config && matches(config, target)) {
      confirmApplied(commandName, target);
    }
  }, [pending, target, config, matches, confirmApplied, commandName]);

  useEffect(() => {
    if (!pending) return;
    const timer = setInterval(
      () => void queryClient.invalidateQueries({ queryKey: TTS_CONFIG_QUERY_KEY }),
      CONVERGENCE_POLL_MS
    );
    return () => clearInterval(timer);
  }, [pending, queryClient]);

  // A failure/timeout leaves its reason in the config; read it once now.
  useEffect(() => {
    if (isFailed || isTimeout) void queryClient.invalidateQueries({ queryKey: TTS_CONFIG_QUERY_KEY });
  }, [isFailed, isTimeout, queryClient]);

  function apply(value: V) {
    setTarget(value);
    void command.run(commandName, value);
  }

  return {
    pending,
    failed: isFailed || isTimeout,
    /** A command the server refused outright (409, 422, network): shown as-is. */
    requestError: command.error?.message ?? null,
    target: pending ? target : null,
    apply
  };
}

function ListError({ onRetry }: { onRetry: () => void }) {
  const t = useT();
  return (
    <div className="flex flex-wrap items-center gap-2">
      <p role="alert" className="text-xs leading-relaxed text-danger">
        {t("controles.voice.list.error")}
      </p>
      <Button type="button" variant="outline" onClick={onRetry}>
        {t("controles.voice.list.retry")}
      </Button>
    </div>
  );
}

function FailureAlert({ message }: { message: string }) {
  return (
    <p role="alert" aria-live="assertive" className="text-xs leading-relaxed text-danger">
      {message}
    </p>
  );
}

function piperOptions(voices: PiperVoice[], currentId: string | undefined, t: ReturnType<typeof useT>): SelectOption[] {
  const options: SelectOption[] = voices.map((voice) => ({
    value: voice.id,
    label:
      voice.status === "incomplete" && voice.reason
        ? `${voice.label} (${t(`controles.voice.piper.reason.${voice.reason}` as TKey)})`
        : voice.label,
    disabled: voice.status === "incomplete"
  }));
  // The active voice may sit outside the filtered list (another folder or locale):
  // keep it visible instead of rendering a blank select.
  if (currentId && !options.some((o) => o.value === currentId)) {
    options.unshift({ value: currentId, label: currentId });
  }
  return options;
}

/**
 * Voice choice for Kira, replacing the hand-kept language list: Piper catalog
 * (voice + speaker + folder) when local-only is on, Edge-TTS catalog otherwise,
 * both filtered by the backend's active locale (GET /api/i18n `active_locale`;
 * the UI locale is only the fallback while that loads). Voice, speaker and
 * folder controls lock together while any switch is applying.
 */
export function VoiceCatalogSection({
  config,
  onPendingChange
}: {
  config: TtsConfig | undefined;
  /** Lets the card header mirror a pending voice/speaker switch. */
  onPendingChange?: (pending: boolean) => void;
}) {
  const t = useT();
  const { locale: uiLocale } = useUiLocale();
  const i18nQuery = useQuery({ queryKey: ["i18n"], queryFn: getI18nState, staleTime: 60_000 });
  const lang = primaryLocale((i18nQuery.data?.active_locale ?? "").trim() || uiLocale) || uiLocale;
  const piperMode = config?.local_only ?? true;
  // Wait for the locale to settle so the catalog is not fetched for the wrong language first.
  const localeSettled = !i18nQuery.isPending;
  const piperQuery = usePiperVoicesQuery(lang, { enabled: piperMode && localeSettled });
  const edgeQuery = useEdgeVoicesQuery(lang, { enabled: !piperMode && localeSettled });

  const piper = useVoiceSwitch<PiperVoiceCommandValue>("set_piper_voice", config, piperMatches);
  const edge = useVoiceSwitch<string>("set_edge_voice", config, edgeMatches);
  const locked = piper.pending || edge.pending;
  useEffect(() => onPendingChange?.(locked), [locked, onPendingChange]);

  if (!piperMode) {
    const current = edge.target ?? config?.edge_voice ?? "";
    const options: SelectOption[] = (edgeQuery.data?.voices ?? []).map((v) => ({ value: v.id, label: v.label }));
    if (current && !options.some((o) => o.value === current)) options.unshift({ value: current, label: current });
    return (
      <section aria-labelledby="edge-voice-label" className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <span id="edge-voice-label" className={LABEL_CLASS}>
            <AudioLines size={14} className="text-muted-foreground" aria-hidden="true" />
            {t("controles.voice.edge.voiceSelect")}
          </span>
        </div>
        <Select
          aria-label={t("controles.voice.edge.voiceSelect")}
          value={current}
          disabled={locked || edgeQuery.isPending || edgeQuery.isError}
          loading={edgeQuery.isPending}
          options={options}
          onChange={edge.apply}
        />
        {edgeQuery.isError && <ListError onRetry={() => void edgeQuery.refetch()} />}
        {edgeQuery.data?.source === "fallback" && (
          <p role="status" className="text-xs leading-relaxed text-muted-foreground">
            {t("controles.voice.edge.offline")}
          </p>
        )}
        {edge.failed && <FailureAlert message={t(failureKey("edge", config?.edge_voice_failure_reason))} />}
        {!edge.failed && edge.requestError && <FailureAlert message={edge.requestError} />}
      </section>
    );
  }

  const voices = piperQuery.data ?? [];
  const currentId = piper.target?.value ?? config?.piper_voice_id ?? config?.piper_voice ?? undefined;
  const currentVoice = voices.find((v) => v.id === currentId);
  const speakers = currentVoice && currentVoice.num_speakers > 1 ? currentVoice.speakers : [];
  const currentSpeaker = String(piper.target?.speaker_id ?? config?.piper_speaker_id ?? 0);
  const empty = piperQuery.isSuccess && !voices.some((v) => v.status === "ok");

  function pickVoice(id: string) {
    const voice = voices.find((v) => v.id === id);
    piper.apply(voice && voice.num_speakers > 1 ? { value: id, speaker_id: voice.speakers[0]?.id ?? 0 } : { value: id });
  }

  return (
    <section aria-labelledby="piper-voice-label" className="space-y-2.5">
      <PiperFolderRow disabled={locked} />
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <span id="piper-voice-label" className={LABEL_CLASS}>
            <AudioLines size={14} className="text-muted-foreground" aria-hidden="true" />
            {t("controles.voice.piper.voiceSelect")}
          </span>
        </div>
        <Select
          aria-label={t("controles.voice.piper.voiceSelect")}
          value={currentId ?? ""}
          disabled={locked || piperQuery.isPending || piperQuery.isError}
          loading={piperQuery.isPending}
          options={piperOptions(voices, currentId, t)}
          onChange={pickVoice}
        />
        {piperQuery.isError && <ListError onRetry={() => void piperQuery.refetch()} />}
        {empty && <p className="text-xs leading-relaxed text-muted-foreground">{t("controles.voice.list.empty")}</p>}
        {piper.failed && <FailureAlert message={t(failureKey("piper", config?.piper_switch_failure_reason))} />}
        {!piper.failed && piper.requestError && <FailureAlert message={piper.requestError} />}
      </div>
      {speakers.length > 0 && (
        <div className="space-y-2">
          <span className={LABEL_CLASS}>
            <Users size={14} className="text-muted-foreground" aria-hidden="true" />
            {t("controles.voice.piper.speakerSelect")}
          </span>
          <Select
            aria-label={t("controles.voice.piper.speakerSelect")}
            value={currentSpeaker}
            disabled={locked}
            options={speakers.map((s) => ({ value: String(s.id), label: s.name }))}
            onChange={(id) => piper.apply({ value: currentId as string, speaker_id: Number(id) })}
          />
        </div>
      )}
    </section>
  );
}
