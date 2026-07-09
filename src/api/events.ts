import { useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { getApiBaseUrl } from "./client.js";
import { emitAppEvent } from "../lib/appEvents.js";
import type { AppEventSource } from "../store/eventStore.js";

/**
 * GET /api/events?since=cursor (item B) predates types.gen.ts's OpenAPI
 * generation, so it has no generated type — hand-typed from
 * opencohost/api/models.py::EventOut / EventLogResponse. `source` is always
 * "motor" today; `action` is drawn from EngineHost's CLOSED
 * _MOTOR_EVENT_WHITELIST; `detail` is always null (schema parity only).
 * ponytail: keep in sync manually until the snapshot is regenerated.
 */
export interface ServerEvent {
  seq: number;
  ts: number;
  source: string;
  action: string;
  detail: string | null;
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
  const lastCursor = useRef(0);
  const lastBoot = useRef<number | null>(null);

  const query = useQuery({
    queryKey: EVENTS_QUERY_KEY,
    queryFn: () => getEventLog(lastCursor.current), // ref read fresh each poll
    refetchInterval: 1500, // matches status.ts cadence
    refetchIntervalInBackground: false
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

    for (const e of data.events) {
      if (e.seq <= lastCursor.current) continue;
      emitAppEvent(
        // ServerEvent.source is a plain string; emitAppEvent's own whitelist
        // (not this cast) is what actually gates an unmapped value.
        { source: e.source as AppEventSource, action: e.action, detail: e.detail ?? undefined },
        `srv-${e.seq}`,
        // Server ts is epoch seconds (Python time.time()); store sorts by JS ms.
        { toast: false, ts: e.ts * 1000 }
      );
    }
    lastCursor.current = data.cursor;
  }, [query.data]);

  return query;
}
