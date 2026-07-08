import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError, NotFoundError, ValidationError, authFetch, getApiBaseUrl } from "./client.js";

/**
 * GET/POST/PUT /api/agenda* (opencohost/api/main.py ~472-533) predates
 * types.gen.ts's OpenAPI generation, so it has no generated type —
 * hand-typed from opencohost/api/models.py::AgendaResponse and friends.
 * ponytail: keep in sync manually if those models change.
 */
export interface AgendaTopicOut {
  id: string;
  title: string;
  angle: string;
  priority: string;
  response_length: string;
  status: string;
  turns_spoken: number;
  confidence: string;
  source: string;
}

export interface AgendaSessionSettings {
  max_turns_per_topic: number;
  rhythm: string;
  response_length: string;
  safety_mode: string;
  profile_style: string;
}

export interface AgendaMetrics {
  total_rejections: number;
  by_error_code: Record<string, number>;
  by_guardrail: Record<string, number>;
  avg_similarity_overlap_pct: number | null;
  current_state: string;
  failure_count: number;
  response_length: string;
  active_topic: string | null;
  topics_queued: number;
  last_outputs_count: number;
}

export interface AgendaResponse {
  state: string;
  active_topic: AgendaTopicOut | null;
  queued_topics: AgendaTopicOut[];
  drafted_topics: AgendaTopicOut[];
  session_settings: AgendaSessionSettings;
  metrics: AgendaMetrics;
  /**
   * FIX-C: POST /api/agenda/session/action outcome. `applied` is `false` with
   * `reason === "empty_queue"` when `enable` is refused because the queue is
   * empty and no topic is active (CTK parity — the backend never starts a
   * silent session). Every other agenda response leaves both null/absent.
   */
  applied?: boolean | null;
  reason?: string | null;
}

export interface AgendaTopicRequest {
  title: string;
  angle?: string;
  /** WU7 backend fields (opencohost/api/models.py::AgendaTopicRequest). All
   * optional — the backend defaults priority/response_length to "normal" and
   * constraints to none. ponytail: keep in sync manually. */
  constraints?: string[];
  priority?: string;
  response_length?: string;
}

/** Whitelisted verbs mirror `_AGENDA_ACTION_WHITELIST` in main.py — "reject"
 * maps to `KiraAgendaController.reject_topic` (drafted-topic dismissal). */
export type AgendaTopicAction = "approve" | "queue" | "remove" | "move" | "reject";

export interface AgendaTopicActionRequest {
  action: AgendaTopicAction;
  topic_id: string;
  direction?: number;
}

/** PUT body — partial update, mirrors AgendaSessionRequest. An omitted
 * field leaves the stored value unchanged. */
export interface AgendaSessionRequest {
  profile?: { style?: string };
  max_turns_per_topic?: number;
  rhythm?: string;
  response_length?: string;
  safety_mode?: string;
}

/**
 * POST /api/agenda/session/action body — session lifecycle verbs, whitelisted
 * server-side against `_AGENDA_SESSION_ACTION_WHITELIST` in main.py (mirrors
 * `AgendaTopicActionRequest`'s "accept any string, let the handler 422"
 * pattern). "enable" starts the session, "soft_stop" pauses pending an
 * operator, "emergency_stop" hard-pauses.
 */
export type AgendaSessionAction = "enable" | "soft_stop" | "emergency_stop";

export interface AgendaSessionActionRequest {
  action: AgendaSessionAction;
}

/**
 * One saved co-host profile, mirrors `CohostProfileOut`
 * (opencohost/api/models.py). Persisted on disk — `GET`/`POST`
 * /api/agenda/cohost-profiles never carry a `selected` field, selection is
 * stateless (RAM-only on the running controller).
 * ponytail: keep in sync manually.
 */
export interface CohostProfileOut {
  name: string;
  style: string;
  default_priority: string;
  default_response_length: string;
}

export interface CohostProfilesResponse {
  profiles: CohostProfileOut[];
}

/** POST /api/agenda/cohost-profiles body — `priority`/`length` map to the
 * stored default_priority/default_response_length (CTK save-form parity). */
export interface CohostProfileSaveRequest {
  name: string;
  style: string;
  priority?: string;
  length?: string;
}

/** POST /api/agenda/cohost-profiles/select body. */
export interface CohostProfileSelectRequest {
  name: string;
}

/** POST /api/agenda/cohost-profiles/select response — RAM-only apply, does
 * not persist and does not itself carry the updated AgendaResponse (the
 * caller should invalidate the agenda query to see the new profile_style). */
export interface CohostProfileSelectResponse {
  selected: string;
}

export const AGENDA_QUERY_KEY = ["agenda"] as const;
export const COHOST_PROFILES_QUERY_KEY = ["cohost-profiles"] as const;

async function extractAgendaDetail(res: Response, fallback: string): Promise<string> {
  try {
    const body = (await res.json()) as { detail?: string };
    return body.detail ?? fallback;
  } catch {
    // non-JSON error body — fall back to a generic message.
    return fallback;
  }
}

async function parseAgendaError(res: Response, fallback: string): Promise<never> {
  const detail = await extractAgendaDetail(res, fallback);
  if (res.status === 422) {
    throw new ValidationError(detail);
  }
  throw new ApiError(detail, res.status);
}

export async function getAgenda(): Promise<AgendaResponse> {
  const res = await fetch(`${getApiBaseUrl()}/api/agenda`);
  if (!res.ok) {
    return parseAgendaError(res, `GET /api/agenda failed with ${res.status}`);
  }
  return (await res.json()) as AgendaResponse;
}

export async function postAgendaTopic(body: AgendaTopicRequest): Promise<AgendaResponse> {
  const res = await authFetch(`${getApiBaseUrl()}/api/agenda/topic`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    return parseAgendaError(res, `POST /api/agenda/topic failed with ${res.status}`);
  }
  return (await res.json()) as AgendaResponse;
}

export async function postAgendaTopicAction(body: AgendaTopicActionRequest): Promise<AgendaResponse> {
  const res = await authFetch(`${getApiBaseUrl()}/api/agenda/topic/action`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    return parseAgendaError(res, `POST /api/agenda/topic/action failed with ${res.status}`);
  }
  return (await res.json()) as AgendaResponse;
}

export async function putAgendaSession(body: AgendaSessionRequest): Promise<AgendaResponse> {
  const res = await authFetch(`${getApiBaseUrl()}/api/agenda/session`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    return parseAgendaError(res, `PUT /api/agenda/session failed with ${res.status}`);
  }
  return (await res.json()) as AgendaResponse;
}

/** POST /api/agenda/session/action — enable / soft_stop / emergency_stop. */
export async function postAgendaSessionAction(body: AgendaSessionActionRequest): Promise<AgendaResponse> {
  const res = await authFetch(`${getApiBaseUrl()}/api/agenda/session/action`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    return parseAgendaError(res, `POST /api/agenda/session/action failed with ${res.status}`);
  }
  return (await res.json()) as AgendaResponse;
}

/**
 * GET /api/agenda/cohost-profiles — disk-only read, no host/agenda needed.
 * Falls back to 3 defaults server-side when the profiles file is absent.
 */
export async function getCohostProfiles(): Promise<CohostProfilesResponse> {
  const res = await fetch(`${getApiBaseUrl()}/api/agenda/cohost-profiles`);
  if (!res.ok) {
    throw new ApiError(
      await extractAgendaDetail(res, `GET /api/agenda/cohost-profiles failed with ${res.status}`),
      res.status
    );
  }
  return (await res.json()) as CohostProfilesResponse;
}

/**
 * POST /api/agenda/cohost-profiles — creates/overwrites a saved profile by
 * name. 422 on an empty/invalid name (sanitize_profile_name), 503 if the
 * disk write itself fails (cohost_write_failed).
 */
export async function saveCohostProfile(body: CohostProfileSaveRequest): Promise<CohostProfilesResponse> {
  const res = await authFetch(`${getApiBaseUrl()}/api/agenda/cohost-profiles`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  if (res.status === 422) {
    throw new ValidationError(await extractAgendaDetail(res, "empty profile name"));
  }
  if (res.status === 503) {
    throw new ApiError(await extractAgendaDetail(res, "cohost_write_failed"), 503);
  }
  if (!res.ok) {
    throw new ApiError(`POST /api/agenda/cohost-profiles failed with ${res.status}`, res.status);
  }
  return (await res.json()) as CohostProfilesResponse;
}

/**
 * POST /api/agenda/cohost-profiles/select — applies a saved profile's style
 * to the RUNNING agenda controller (RAM-only, never persisted). 404 when
 * the name isn't a known saved profile, 422 if the controller rejects the
 * style, 503 if the agenda isn't wired up on the host.
 */
export async function selectCohostProfile(body: CohostProfileSelectRequest): Promise<CohostProfileSelectResponse> {
  const res = await authFetch(`${getApiBaseUrl()}/api/agenda/cohost-profiles/select`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  if (res.status === 404) {
    throw new NotFoundError(await extractAgendaDetail(res, "profile not found"));
  }
  if (res.status === 422) {
    throw new ValidationError(await extractAgendaDetail(res, "invalid profile style"));
  }
  if (!res.ok) {
    throw new ApiError(
      await extractAgendaDetail(res, `POST /api/agenda/cohost-profiles/select failed with ${res.status}`),
      res.status
    );
  }
  return (await res.json()) as CohostProfileSelectResponse;
}

export function useAgendaQuery() {
  return useQuery({
    queryKey: AGENDA_QUERY_KEY,
    queryFn: getAgenda
  });
}

/**
 * One agenda lifecycle event surfaced into the conversation stream. `id` is a
 * content-derived dedup key (mirrors ConversationPanel's `kira-reply-${turn_id}`
 * dedup), `label` is the divider copy, `ts` is the client arrival time used to
 * interleave events with chat turns.
 */
export interface AgendaEvent {
  id: string;
  label: string;
  ts: number;
}

const AGENDA_PAUSED_STATES = new Set(["PAUSED", "HARD_PAUSED"]);

/**
 * Diffs two consecutive agenda snapshots into the events they imply. Only the
 * first matching case fires per snapshot — a finished/paused transition is
 * mutually exclusive with a turn advance.
 */
function diffAgendaSnapshots(prev: AgendaResponse, next: AgendaResponse): Array<Pick<AgendaEvent, "id" | "label">> {
  const prevTopic = prev.active_topic;
  const nextTopic = next.active_topic;

  // Session finished: state fell to OFF, or a live topic dropped back to null.
  if ((next.state === "OFF" && prev.state !== "OFF") || (prevTopic !== null && nextTopic === null)) {
    return [{ id: `agenda-finished-${prevTopic?.id ?? prev.state}`, label: "■ agenda finalizada" }];
  }

  // Session paused / hard-paused, pending an operator.
  if (AGENDA_PAUSED_STATES.has(next.state) && next.state !== prev.state) {
    return [{ id: `agenda-paused-${next.state}-${nextTopic?.id ?? "none"}`, label: "⏸ agenda en pausa" }];
  }

  if (nextTopic === null) return [];

  // A different topic took the floor (both sides non-null, ids differ).
  if (prevTopic !== null && prevTopic.id !== nextTopic.id) {
    return [{ id: `agenda-${nextTopic.id}-active`, label: `▸ tema: ${nextTopic.title}` }];
  }

  // Topic just activated (null -> set) or the same topic spoke another turn.
  const advancedTurn = prevTopic !== null && prevTopic.id === nextTopic.id && nextTopic.turns_spoken > prevTopic.turns_spoken;
  if (prevTopic === null || advancedTurn) {
    return [
      { id: `agenda-${nextTopic.id}-turn-${nextTopic.turns_spoken}`, label: `▸ turno ${nextTopic.turns_spoken} · tema: ${nextTopic.title}` }
    ];
  }

  return [];
}

/**
 * Polls GET /api/agenda (same 1500ms cadence as useLastReply) and turns each
 * snapshot delta into an accumulating AgendaEvent stream. Owns its own polling
 * observer on AGENDA_QUERY_KEY so AgendaPanel's useAgendaQuery keeps its
 * fetch-once behavior — both share the cache, so the poll refreshes the panel
 * too.
 *
 * The first snapshot only seeds the baseline (no emit) — mirrors the
 * awaitingBaseline anchoring for Kira replies in ConversationPanel, so mounting
 * mid-session doesn't replay the current topic as a fresh event.
 *
 * ponytail: polling SAMPLES the agenda — a `turns_spoken` jump of 2 between two
 * polls collapses into a single "turno N" event (the intermediate turn is
 * lost). A server-ordered event log would close that gap; not worth it until a
 * gapless transcript is actually required.
 */
export function useAgendaEvents(): AgendaEvent[] {
  const { data } = useQuery({
    queryKey: AGENDA_QUERY_KEY,
    queryFn: getAgenda,
    refetchInterval: 1500,
    refetchIntervalInBackground: false
  });
  const prevRef = useRef<AgendaResponse | null>(null);
  const seenRef = useRef<Set<string>>(new Set());
  const [events, setEvents] = useState<AgendaEvent[]>([]);

  useEffect(() => {
    if (!data) return;
    const prev = prevRef.current;
    prevRef.current = data;
    if (prev === null) return; // first snapshot only anchors the baseline
    const fresh = diffAgendaSnapshots(prev, data).filter((event) => !seenRef.current.has(event.id));
    if (fresh.length === 0) return;
    const ts = Date.now();
    for (const event of fresh) seenRef.current.add(event.id);
    setEvents((current) => [...current, ...fresh.map((event) => ({ ...event, ts }))]);
  }, [data]);

  return events;
}

/**
 * Every agenda mutation's response is the same full `AgendaResponse` the GET
 * returns — writing it straight into the query cache keeps Now/Queue in
 * sync without a second round-trip or any local queue/now state to drift.
 */
function useAgendaMutation<TVariables>(mutationFn: (vars: TVariables) => Promise<AgendaResponse>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: (data) => {
      queryClient.setQueryData(AGENDA_QUERY_KEY, data);
    }
  });
}

export function useAddAgendaTopicMutation() {
  return useAgendaMutation(postAgendaTopic);
}

export function useAgendaTopicActionMutation() {
  return useAgendaMutation(postAgendaTopicAction);
}

export function useUpdateAgendaSessionMutation() {
  return useAgendaMutation(putAgendaSession);
}

export function useAgendaSessionActionMutation() {
  return useAgendaMutation(postAgendaSessionAction);
}

export function useCohostProfilesQuery() {
  return useQuery({
    queryKey: COHOST_PROFILES_QUERY_KEY,
    queryFn: getCohostProfiles
  });
}

export function useSaveCohostProfileMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: saveCohostProfile,
    onSuccess: (data) => {
      queryClient.setQueryData(COHOST_PROFILES_QUERY_KEY, data);
    }
  });
}

/**
 * Selecting a saved profile changes the running agenda controller's
 * `profile_style`, which only shows up again via GET /api/agenda — the
 * select response itself carries no AgendaResponse, so invalidate (not
 * setQueryData) to pick up the new profile_style on next read.
 */
export function useSelectCohostProfileMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: selectCohostProfile,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: AGENDA_QUERY_KEY });
    }
  });
}
