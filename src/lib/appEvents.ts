import { useEventStore, type AppEvent, type AppEventSource, type AppEventTone } from "../store/eventStore.js";
import type { QueryClient } from "@tanstack/react-query";
import { t, type TKey } from "../i18n/t.js";

/** What a mutation may DECLARE. Note what this type cannot express: there is
 * no `label`, no `message`, no `text`, no `body` field — a hook cannot hand
 * this module a sentence to display even if it tries. */
export interface AppEventInput {
  source: AppEventSource;
  action: string;
  /** Short identifier only (model id, profile name, mood, scene). Runs
   * through sanitizeDetail — prose gets dropped, not truncated-and-shown. */
  detail?: string;
  tone?: AppEventTone;
}

/** Static object, or a function of the mutation variables for generic hooks
 * (useEngineCommand). The function form is still safe: whatever it returns
 * re-enters the same whitelist + sanitizer below. */
export type AppEventMeta = AppEventInput | ((variables: unknown) => AppEventInput | null);

declare module "@tanstack/react-query" {
  interface Register {
    mutationMeta: { event?: AppEventMeta };
  }
}

/* ------------------------------------------------------------------ */
/* PRIVACY CHOKEPOINT. Labels can ONLY be produced by this template     */
/* map. Unknown source.action pairs are dropped entirely. The only      */
/* variable text is `detail`, clamped by sanitizeDetail. This module    */
/* NEVER reads mutation response data, request bodies, or error text.  */
/* Same lens as the API audit log: metadata / action only — never Kira  */
/* dialogue, viewer chat, prompt text, or request/response bodies.     */
/* ------------------------------------------------------------------ */

const EVENT_LABELS: Record<string, (detail?: string) => string> = {
  "model.switch": (d) =>
    d ? t("experiencia.events.modelSwitch.withDetail", { detail: d }) : t("experiencia.events.modelSwitch.plain"),
  "settings.update": (d) =>
    d ? t("experiencia.events.settingsUpdate.withDetail", { detail: d }) : t("experiencia.events.settingsUpdate.plain"),
  "settings.clear-history": () => t("experiencia.events.settingsClearHistory"),
  "profile.switch": (d) =>
    d ? t("experiencia.events.profileSwitch.withDetail", { detail: d }) : t("experiencia.events.profileSwitch.plain"),
  "profile.cohost-select": (d) =>
    d
      ? t("experiencia.events.profileCohostSelect.withDetail", { detail: d })
      : t("experiencia.events.profileCohostSelect.plain"),
  "music.mood": (d) =>
    d ? t("experiencia.events.musicMood.withDetail", { detail: d }) : t("experiencia.events.musicMood.plain"),
  "music.fade": (d) => (d === "in" ? t("experiencia.events.musicFade.in") : t("experiencia.events.musicFade.out")),
  "music.import": (d) =>
    d ? t("experiencia.events.musicImport.withDetail", { detail: d }) : t("experiencia.events.musicImport.plain"),
  "music.delete": () => t("experiencia.events.musicDelete"),
  "obs.toggle": (d) => (d === "on" ? t("experiencia.events.obsToggle.on") : t("experiencia.events.obsToggle.off")),
  "obs.config": (d) =>
    d ? t("experiencia.events.obsConfig.withDetail", { detail: d }) : t("experiencia.events.obsConfig.plain"),
  // multi_provider_llm — operator provider actions. `detail` is a provider id
  // or "Local" only (identifier-shaped); an api_key NEVER reaches here (the
  // mutation's meta.event only ever passes active_provider/profile_id).
  "llm-provider.activate": (d) =>
    d
      ? t("experiencia.events.llmProviderActivate.withDetail", { detail: d })
      : t("experiencia.events.llmProviderActivate.plain"),
  "llm-provider.profile": (d) =>
    d
      ? t("experiencia.events.llmProviderProfile.withDetail", { detail: d })
      : t("experiencia.events.llmProviderProfile.plain"),
  "llm-provider.delete": (d) =>
    d
      ? t("experiencia.events.llmProviderDelete.withDetail", { detail: d })
      : t("experiencia.events.llmProviderDelete.plain"),
  "llm-provider.posture": () => t("experiencia.events.llmProviderPosture"),
  // cloud_rearm_20260801 WU4 — manual re-arm click (audits the click only;
  // the armed/reason outcome renders from mutation.data, never this label).
  "llm-provider.probe": () => t("experiencia.events.llmProviderProbe"),
  "stream.connect": () => t("experiencia.events.streamConnect"),
  "stream.disconnect": () => t("experiencia.events.streamDisconnect"),
  "stream.limits": () => t("experiencia.events.streamLimits"),
  "agenda.session-action": (d) =>
    d
      ? t("experiencia.events.agendaSessionAction.withDetail", { detail: d })
      : t("experiencia.events.agendaSessionAction.plain"),
  // PTT hold gesture (liveaudio_ptt_tauri_20260710) — replaces the retired
  // "ptt.toggle" stub label now that PTTCard drives real /api/ptt/* mutations.
  "ptt.started": () => t("experiencia.events.pttStarted"),
  "ptt.stopped": () => t("experiencia.events.pttStopped"),
  "ptt.error": () => t("experiencia.events.pttError"),
  "ptt.buffer_full": () => t("experiencia.events.pttBufferFull"),

  // --- Item B: engine-initiated motor events (feed-only, never toasted).
  // Deliberate SUBSET of the server's whitelist (engine_host.py) — per-turn
  // churn (processing/idle/speaking_start/speaking_end) is intentionally
  // NOT mapped here, so it's dropped by the "unknown key" branch below and
  // never spams the feed. Those known-but-unmapped keys live in KNOWN_SILENT
  // so they drop WITHOUT the DEV warn (reserved for genuinely unrecognized
  // keys). detail is always null server-side; templates ignore it. ---
  "motor.ready": () => t("shell.events.motor.ready"),
  "motor.model_warming": () => t("shell.events.motor.modelWarming"),
  "motor.ollama_unavailable": () => t("shell.events.motor.ollamaUnavailable"),
  "motor.llm_timeout_recovered": () => t("shell.events.motor.llmTimeoutRecovered"),
  "motor.model_switch_pending": () => t("shell.events.motor.modelSwitchPending"),
  "motor.model_switch_applied": () => t("shell.events.motor.modelSwitchApplied"),
  "motor.model_switch_failed": () => t("shell.events.motor.modelSwitchFailed"),
  "motor.model_changed": () => t("shell.events.motor.modelChanged"),
  "motor.llm_tier_switch_applied": () => t("shell.events.motor.llmTierSwitchApplied"),
  "motor.llm_tier_switch_failed": () => t("shell.events.motor.llmTierSwitchFailed"),
  "motor.download_start": () => t("shell.events.motor.downloadStart"),
  "motor.download_done": () => t("shell.events.motor.downloadDone"),
  "motor.download_error": () => t("shell.events.motor.downloadError"),
  // Unit 2.5 (runtime_findings_batch_20260731 F10/2.3): the ONE motor.* key
  // whose server detail is no longer always null — engine_host.py's
  // ctx_pressure_high now carries a numeric-only dict; events.ts's poll loop
  // reduces it to a plain ratio-percent string (identifier-shaped, survives
  // sanitizeDetail) before it ever reaches this template. No dialogue, no
  // free text — just the number, same privacy contract as every other row here.
  "motor.ctx_pressure_high": (d) =>
    d ? t("shell.events.motor.ctxPressureHigh.withDetail", { pct: d }) : t("shell.events.motor.ctxPressureHigh.plain"),
  "motor.piper_voice_locale_mismatch": () => t("shell.events.motor.piperVoiceLocaleMismatch"),
  // E1 (memoria_quality_20260717): fresh-memoria notice. Owner decision 5 —
  // shown as a chat-panel FEED line (motor.* is feed-only, never toasted), not
  // just a toast. Feed-visible on purpose (NOT in KNOWN_SILENT). `detail`
  // carries an optional coalesced COUNT (a plain integer string) folded in by
  // the events.ts poll loop when a burst lands in one batch; singular otherwise.
  // The count is the only variable text and stays identifier-shaped (survives
  // sanitizeDetail) — no memoria title/content ever rides along.
  "motor.memoria_captured": (d) => {
    const n = Number(d);
    return Number.isFinite(n) && n > 1
      ? t("shell.events.motor.memoriaCaptured.many", { n })
      : t("shell.events.motor.memoriaCaptured.one");
  },
  // multi_provider_llm — the engine hit a cloud LLM failure. Feed-only (motor.*
  // is never toasted), honest and actionable: it does NOT auto-switch, so the
  // operator stays on cloud and must act. `detail` is always null server-side.
  "motor.cloud_llm_error": () => t("shell.events.motor.cloudLlmError"),
  // Unit 2.1 (runtime_findings_batch_20260731) — `bad_key` cloud class:
  // never retried engine-side, latched to one emission per failure event.
  // `detail` is always null server-side.
  "motor.cloud_bad_key": () => t("shell.events.motor.cloudBadKey"),
  // Unit 2.2 (runtime_findings_batch_20260731) — automatic cloud-return
  // narration. Neutral, generic labels (never per-class text) — the reason
  // CLASS is a separate poll field (GET /api/status → fallback_reason), not
  // event detail. `cloud_probe_scheduled` DOES carry a numeric `seconds`
  // detail server-side (_MOTOR_EVENT_DETAIL_FIELDS), same as
  // `ctx_pressure_high` above — this feed label ignores it on purpose (mirrors
  // that row); a live countdown belongs to a status-poll-driven UI element
  // reading `next_cloud_probe_in_seconds`, not this fire-once feed line.
  "motor.cloud_fallback_engaged": () => t("shell.events.motor.cloudFallbackEngaged"),
  "motor.cloud_probe_scheduled": () => t("shell.events.motor.cloudProbeScheduled"),
  "motor.cloud_restored": () => t("shell.events.motor.cloudRestored"),
  // WU3 (cloud_rearm_20260801) — the conservative ambiguous_429 auto-return
  // gave up after its bounded attempt count. Points at the manual "Probar
  // ahora" button (WU5), which keeps working after this fires.
  "motor.cloud_probe_gave_up": () => t("shell.events.motor.cloudProbeGaveUp")
};

/** kira-agenda prefetch guardrail refusals (WU4-4b). `action` is dynamic —
 * `guardrail:<code>` — so it cannot live as a fixed EVENT_LABELS key; the
 * code vocabulary is also NOT closed client-side (server can ship new codes),
 * so an unrecognized code renders its own (code-shaped, safe) text instead of
 * dropping the event or crashing. `detail` is always null server-side — the
 * code rides in `action`, never dialogue. */
const GUARDRAIL_ACTION_PREFIX = "guardrail:";
const GUARDRAIL_CODE_KEYS: Record<string, TKey> = {
  contains_internal_leak: "experiencia.events.guardrail.code.containsInternalLeak",
  is_repetition: "experiencia.events.guardrail.code.isRepetition",
  banned_closure: "experiencia.events.guardrail.code.bannedClosure"
};

function guardrailLabel(action: string): string {
  const code = action.slice(GUARDRAIL_ACTION_PREFIX.length);
  const codeKey = GUARDRAIL_CODE_KEYS[code];
  return t("experiencia.events.guardrail.label", { label: codeKey ? t(codeKey) : code });
}

/* KNOWN-but-unmapped: valid backend actions (engine_host.py / ptt_session.py)
 * we deliberately DON'T surface — per-turn engine churn and PTT flush internals
 * that would spam the feed. They drop silently, without the DEV "unknown event"
 * warn that flags a genuinely unrecognized key (a real "forgot to map this").
 * motor.speaking_start/end + motor.idle are ALSO routed to the avatar store in
 * src/api/events.ts before they reach here — silent in the feed, live for the
 * avatar. */
const KNOWN_SILENT = new Set<string>([
  "motor.processing",
  "motor.idle",
  "motor.speaking_start",
  "motor.speaking_end",
  "ptt.flushed",
  "ptt.empty",
  "ptt.auto_stopped"
]);

const MAX_DETAIL_CHARS = 48;
const MAX_DETAIL_WORDS = 6;

/** Identifier-shaped input passes; body-shaped input is DROPPED (not shown
 * truncated — a truncated chat message is still a leak). Heuristic split:
 * identifiers (model ids, profile names, moods, scene names) are short and
 * few-worded; dialogue/prose is many-worded. */
export function sanitizeDetail(detail: string | undefined): string | undefined {
  if (detail === undefined) return undefined;
  const flat = detail.replace(/[\r\n\t]+/g, " ").replace(/\s+/g, " ").trim();
  if (flat.length === 0) return undefined;
  if (flat.split(" ").length > MAX_DETAIL_WORDS) return undefined; // body-like → reject
  return flat.length > MAX_DETAIL_CHARS ? `${flat.slice(0, MAX_DETAIL_CHARS)}…` : flat;
}

/** Toast sink — registered by <EventBridge /> so this non-React module can
 * reuse the EXISTING ToastProvider instead of shipping a second toast system. */
type ToastSink = (message: string, tone: AppEventTone) => void;
let toastSink: ToastSink | null = null;
export function setToastSink(sink: ToastSink | null): void {
  toastSink = sink;
}

let manualSeq = 0;

/** THE emission point. Everything visible (toast text, feed label) is born
 * here and only here. `opts.toast: false` (item B — server-originated engine
 * events) persists the event to the feed but skips the toast; operator
 * mutations (item A) keep toasting by default. `opts.ts` (epoch MILLISECONDS)
 * lets server-originated events keep their real timestamp on backfill;
 * operator events omit it and get Date.now(). */
export function emitAppEvent(input: AppEventInput, id?: string, opts?: { toast?: boolean; ts?: number }): void {
  const isGuardrail = input.source === "kira-agenda" && input.action.startsWith(GUARDRAIL_ACTION_PREFIX);
  const key = `${input.source}.${input.action}`;
  const template = isGuardrail ? undefined : EVENT_LABELS[key];
  if (!isGuardrail && !template) {
    // KNOWN_SILENT keys drop quietly; only genuinely unrecognized keys warn.
    if (import.meta.env.DEV && !KNOWN_SILENT.has(key)) {
      console.warn(`[appEvents] dropped unknown event ${key}`);
    }
    return; // not whitelisted → no event, no toast. Free text cannot enter.
  }
  const label = isGuardrail ? guardrailLabel(input.action) : template!(sanitizeDetail(input.detail));
  const event: AppEvent = {
    id: id ?? `evt-${++manualSeq}-${Date.now()}`,
    ts: opts?.ts ?? Date.now(),
    source: input.source,
    label,
    // Guardrail refusals always warn-tint regardless of caller — a refused
    // prefetch is a notable-but-not-fatal event (I2).
    tone: isGuardrail ? "warn" : (input.tone ?? "ok")
  };
  useEventStore.getState().append(event);
  // Toast unless suppressed. EXCEPTION: ptt.* server echoes pass toast:false
  // (feed-only convention for server events), but PTT lifecycle — including the
  // external F10 bridge, which only emits server events — needs immediate
  // feedback, so ptt.started/stopped/error always toast. (These are the only
  // ptt.* keys mapped above; silent ptt actions never reach here.)
  if (opts?.toast !== false || input.source === "ptt") toastSink?.(label, event.tone);
}

/** Global feeder: one subscriber on the shared MutationCache. Queries (all
 * polling) never pass through here — only discrete operator mutations. */
export function subscribeMutationEvents(queryClient: QueryClient): () => void {
  return queryClient.getMutationCache().subscribe((cacheEvent) => {
    if (cacheEvent.type !== "updated" || cacheEvent.action.type !== "success") return;
    const meta = cacheEvent.mutation.options.meta?.event;
    if (!meta) return; // no meta.event → invisible to the event engine (e.g. chat send)
    const input = typeof meta === "function" ? meta(cacheEvent.mutation.state.variables) : meta;
    if (input) emitAppEvent(input, `mut-${cacheEvent.mutation.mutationId}`);
  });
}
