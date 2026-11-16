import { useEffect, useRef } from "react";
import { useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { getApiBaseUrl } from "./client.js";
import { emitAppEvent } from "../lib/appEvents.js";
import { useAvatarLiveState } from "../store/avatarLiveStore.js";
import type { AppEventSource } from "../store/eventStore.js";
import type { VisionLookDetails } from "../store/visionStore.js";
import { isVisionActivePhase, parseVisionMode, useVisionOffRequestStore, useVisionPhaseStore, useVisionResultStore } from "../store/visionStore.js";
import { VISION_QUERY_KEY, getVision, type VisionResponse } from "./vision.js";

/**
 * GET /api/events?since=cursor (item B) predates types.gen.ts's OpenAPI
 * generation, so it has no generated type — hand-typed from
 * opencohost/api/models.py::EventOut / EventLogResponse. `source` is always
 * "motor" today; `action` is drawn from EngineHost's CLOSED
 * _MOTOR_EVENT_WHITELIST. `detail` is null for every action EXCEPT
 * `ctx_pressure_high` (unit 2.5, runtime_findings_batch_20260731 F10), which
 * carries a small numeric-only dict — see `detailToFeedString` below for how
 * it gets reduced to the identifier-shaped string emitAppEvent expects.
 * ponytail: keep in sync manually until the snapshot is regenerated.
 */
export interface ServerEvent {
  seq: number;
  ts: number;
  source: string;
  action: string;
  detail: string | Record<string, string | number | boolean> | null;
}

/**
 * Reduces a server `detail` to the plain string emitAppEvent's AppEventInput
 * expects — a string passes through; the ONE known numeric-dict shape today
 * (ctx_pressure_high's ratio) becomes a whole-number percent. `sanitizeDetail`
 * still runs downstream, so this only needs to produce an identifier-shaped
 * string, never assemble the visible label itself.
 */
function detailToFeedString(detail: ServerEvent["detail"]): string | undefined {
  if (detail === null) return undefined;
  if (typeof detail === "string") return detail;
  return typeof detail.ratio === "number" ? String(Math.round(detail.ratio * 100)) : undefined;
}

export interface EventLogResponse {
  events: ServerEvent[];
  cursor: number;
  boot: number;
}

export const EVENTS_QUERY_KEY = ["events"] as const;

/** GET /api/events is a read (auth_middleware rule 3: non-mutating reads are
 * never gated) — plain fetch, same as getMusicState/getStatus. */
export async function getEventLog(since: number): Promise<EventLogResponse> {
  const res = await fetch(`${getApiBaseUrl()}/api/events?since=${since}`);
  if (!res.ok) throw new Error(`GET /api/events failed with ${res.status}`);
  return (await res.json()) as EventLogResponse;
}

/**
 * Polls the engine event log at the app cadence and feeds NEW entries
 * through the EXISTING emitAppEvent chokepoint (feed-only, no toast — a
 * second whitelist gate lives there; an unmapped/per-turn motor action is
 * dropped). Renders nothing; mounted once inside EventBridge.
 */
export function useServerEventLog() {
  const queryClient = useQueryClient();
  const lastCursor = useRef(0);
  const lastBoot = useRef<number | null>(null);

  const query = useQuery({
    queryKey: EVENTS_QUERY_KEY,
    queryFn: () => getEventLog(lastCursor.current), // ref read fresh each poll
    refetchInterval: 1500, // matches status.ts cadence
    // Stays live while backgrounded — see status.ts / backgroundPolling.test.ts.
    refetchIntervalInBackground: true
  });

  useEffect(() => {
    const data = query.data;
    if (!data) return;

    // Process restart: seq reset to 0 and boot changed. Adopt the new cursor
    // WITHOUT emitting this batch, so post-restart seq=1.. can't collide with
    // pre-restart srv-<seq> ids already in the store. Genuinely new events
    // emit on the next poll.
    const restarted = lastBoot.current !== null && (data.boot !== lastBoot.current || data.cursor < lastCursor.current);
    lastBoot.current = data.boot;
    if (restarted) {
      lastCursor.current = data.cursor;
      return;
    }

    // E1 (memoria_quality_20260717): coalesce a burst of fresh-memoria notices
    // arriving in ONE poll batch into a single feed line ("Kira guardó N
    // memorias"), instead of N identical "una memoria" lines. Counted here, at
    // the natural batching seam; the plural label is still produced by the
    // EVENT_LABELS chokepoint (count folded in via detail), never assembled
    // here — the module's "labels are born only in the template map" invariant
    // stays intact.
    let memoriaCount = 0;
    let lastMemoria: ServerEvent | null = null;

    for (const e of data.events) {
      if (e.seq <= lastCursor.current) continue;
      // Live avatar signal, feed-independent: mirror the engine's speaking edge
      // into the avatar store so KiraCover reacts at events-poll cadence (1.5s),
      // ahead of the 2s status poll. These motor actions are KNOWN_SILENT in
      // emitAppEvent — routed here, never shown in the feed.
      if (e.source === "motor") {
        if (e.action === "speaking_start") useAvatarLiveState.getState().setSpeaking(true);
        else if (e.action === "speaking_end" || e.action === "idle") useAvatarLiveState.getState().setSpeaking(false);
        else if (e.action === "memoria_captured") {
          memoriaCount += 1;
          lastMemoria = e; // representative seq/ts for the single coalesced emit
          continue; // deferred — emitted once after the loop
        }
      }
      // Vision events (V1.9): metadata only, never a feed row. `vision_looking`
      // flips the indicator now instead of waiting for the next status poll;
      // `vision_result` is kept for the per-turn badge (correlated by time in
      // ConversationPanel) and refreshes the status (state, last_result).
      if (e.source === "vision") {
        routeVisionEvent(e, queryClient);
        continue;
      }
      emitAppEvent(
        // ServerEvent.source is a plain string; emitAppEvent's own whitelist
        // (not this cast) is what actually gates an unmapped value.
        { source: e.source as AppEventSource, action: e.action, detail: detailToFeedString(e.detail) },
        `srv-${e.seq}`,
        // Server ts is epoch seconds (Python time.time()); store sorts by JS ms.
        { toast: false, ts: e.ts * 1000 }
      );
    }
    if (lastMemoria) {
      emitAppEvent(
        {
          source: "motor" as AppEventSource,
          action: "memoria_captured",
          // Count only when >1 — a lone capture omits detail so the template
          // renders the singular "una memoria".
          detail: memoriaCount > 1 ? String(memoriaCount) : undefined
        },
        `srv-${lastMemoria.seq}`,
        { toast: false, ts: lastMemoria.ts * 1000 }
      );
    }
    lastCursor.current = data.cursor;
  }, [query.data, queryClient]);

  return query;
}

function routeVisionEvent(e: ServerEvent, queryClient: QueryClient): void {
  if (e.action === "vision_looking" || e.action === "vision_describing") {
    const looking = typeof e.detail === "object" && e.detail !== null && e.detail.looking === true;
    const phases = useVisionPhaseStore.getState();
    if (looking) phases.setPhase(e.action === "vision_describing" ? "describing" : "looking");
    else if (isVisionActivePhase(phases.phase)) phases.setPhase("idle");
    queryClient.setQueryData<VisionResponse>(VISION_QUERY_KEY, (prev) =>
      prev ? { ...prev, status: { ...prev.status, looking } } : prev
    );
    return;
  }
  if (e.action === "vision_off_request") {
    // Owner asked Kira to look while vision is off. The feed shows an inline
    // "Activar visión" row (ConversationPanel); nothing else to update here.
    useVisionOffRequestStore.getState().append({ id: `srv-${e.seq}`, ts: e.ts * 1000 });
    return;
  }
  if (e.action === "vision_result" && e.detail !== null) {
    // Legacy backends send the outcome as a bare string; newer ones send an
    // object carrying the look details (outcome defaults to "ok" there).
    const payload = typeof e.detail === "object" ? e.detail : null;
    const outcome = typeof e.detail === "string" ? e.detail : typeof payload?.outcome === "string" ? payload.outcome : "ok";
    const id = `srv-${e.seq}`;
    const fromEvent: VisionLookDetails = {
      describeMs: typeof payload?.describe_ms === "number" ? payload.describe_ms : null,
      lookId: typeof payload?.id === "string" ? payload.id : null,
      framesSent: typeof payload?.frames_sent === "number" ? payload.frames_sent : null,
      mode: parseVisionMode(payload?.mode)
    };
    useVisionPhaseStore.getState().setPhase(outcome === "ok" ? "done" : "failed");
    useVisionResultStore.getState().append({ id, ts: e.ts * 1000, outcome, describeMs: null, ...(payload ? fromEvent : {}) });
    const complete = fromEvent.lookId !== null && fromEvent.describeMs !== null && fromEvent.framesSent !== null && fromEvent.mode !== null;
    // The GET only fills what the event did not carry; its failure is harmless.
    if (!complete) {
      void queryClient
        .fetchQuery({ queryKey: VISION_QUERY_KEY, queryFn: getVision, staleTime: 0 })
        .then((data) => {
          const last = data.status.last_result;
          if (last?.outcome !== outcome) return;
          useVisionResultStore.getState().setLookDetails(id, {
            describeMs: fromEvent.describeMs ?? (typeof last.describe_ms === "number" ? last.describe_ms : null),
            lookId: fromEvent.lookId ?? (typeof last.id === "string" ? last.id : null),
            framesSent: fromEvent.framesSent ?? (typeof last.frames_sent === "number" ? last.frames_sent : null),
            mode: fromEvent.mode ?? parseVisionMode(last.mode)
          });
        })
        .catch(() => undefined);
    }
    void queryClient.invalidateQueries({ queryKey: VISION_QUERY_KEY });
  }
}
