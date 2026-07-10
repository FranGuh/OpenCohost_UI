import { useEventStore, type AppEvent, type AppEventSource, type AppEventTone } from "../store/eventStore.js";
import type { QueryClient } from "@tanstack/react-query";

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
  "model.switch": (d) => (d ? `Cambio de modelo enviado → ${d}` : "Cambio de modelo enviado"),
  "settings.update": (d) => (d ? `Ajuste enviado: ${d}` : "Ajustes enviados"),
  "settings.clear-history": () => "Historial de conversación borrado",
  "profile.switch": (d) => (d ? `Perfil → ${d}` : "Perfil cambiado"),
  "profile.cohost-select": (d) => (d ? `Perfil cohost → ${d}` : "Perfil cohost aplicado"),
  "music.mood": (d) => (d ? `Música → ${d}` : "Mood musical cambiado"),
  "music.fade": (d) => (d === "in" ? "Fade in" : "Fade out"),
  "music.import": (d) => (d ? `Pista importada (${d})` : "Pista importada"),
  "music.delete": () => "Pista eliminada",
  "obs.toggle": (d) => (d === "on" ? "OBS activado" : "OBS desactivado"),
  "obs.config": (d) => (d ? `OBS escena → ${d}` : "OBS config actualizada"),
  "stream.connect": () => "Stream conectado",
  "stream.disconnect": () => "Stream desconectado",
  "stream.limits": () => "Límites de chat actualizados",
  "agenda.session-action": (d) => (d ? `Agenda: ${d}` : "Agenda actualizada"),
  // PTT hold gesture (liveaudio_ptt_tauri_20260710) — replaces the retired
  // "ptt.toggle" stub label now that PTTCard drives real /api/ptt/* mutations.
  "ptt.started": () => "PTT escuchando",
  "ptt.stopped": () => "PTT enviado a Kira",
  "ptt.error": () => "PTT: STT no disponible",

  // --- Item B: engine-initiated motor events (feed-only, never toasted).
  // Deliberate SUBSET of the server's whitelist (engine_host.py) — per-turn
  // churn (processing/idle/speaking_start/speaking_end) is intentionally
  // NOT mapped here, so it's dropped by the "unknown key" branch below and
  // never spams the feed. detail is always null server-side; templates
  // ignore it. ---
  "motor.ready": () => "Motor: listo",
  "motor.model_warming": () => "Motor: cargando modelo",
  "motor.ollama_unavailable": () => "Motor: Ollama no disponible",
  "motor.llm_timeout_recovered": () => "Motor: recuperado tras timeout",
  "motor.model_switch_pending": () => "Motor: cambio de modelo en curso",
  "motor.model_switch_applied": () => "Motor: modelo cambiado",
  "motor.model_switch_failed": () => "Motor: fallo al cambiar modelo",
  "motor.model_changed": () => "Motor: modelo cambiado",
  "motor.llm_tier_switch_applied": () => "Motor: nivel LLM cambiado",
  "motor.llm_tier_switch_failed": () => "Motor: fallo al cambiar nivel LLM",
  "motor.download_start": () => "Motor: descarga iniciada",
  "motor.download_done": () => "Motor: descarga completa",
  "motor.download_error": () => "Motor: error de descarga",
  "motor.ctx_pressure_high": () => "Motor: contexto saturado",
  "motor.piper_voice_locale_mismatch": () => "Motor: voz TTS no coincide con el idioma"
};

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
  const template = EVENT_LABELS[`${input.source}.${input.action}`];
  if (!template) {
    if (import.meta.env.DEV) console.warn(`[appEvents] dropped unknown event ${input.source}.${input.action}`);
    return; // not whitelisted → no event, no toast. Free text cannot enter.
  }
  const label = template(sanitizeDetail(input.detail));
  const event: AppEvent = {
    id: id ?? `evt-${++manualSeq}-${Date.now()}`,
    ts: opts?.ts ?? Date.now(),
    source: input.source,
    label,
    tone: input.tone ?? "ok"
  };
  useEventStore.getState().append(event);
  if (opts?.toast !== false) toastSink?.(label, event.tone);
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
