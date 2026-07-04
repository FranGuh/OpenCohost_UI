import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError, ValidationError } from "./client.js";

const BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://127.0.0.1:8000";

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
}

export interface AgendaTopicRequest {
  title: string;
  angle?: string;
}

/** Whitelisted verbs mirror `_AGENDA_ACTION_WHITELIST` in main.py — "reject"
 * is not a controller method and is deliberately absent. */
export type AgendaTopicAction = "approve" | "queue" | "remove" | "move";

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

export const AGENDA_QUERY_KEY = ["agenda"] as const;

async function parseAgendaError(res: Response, fallback: string): Promise<never> {
  let detail = fallback;
  try {
    const body = (await res.json()) as { detail?: string };
    detail = body.detail ?? detail;
  } catch {
    // non-JSON error body — fall back to a generic message.
  }
  if (res.status === 422) {
    throw new ValidationError(detail);
  }
  throw new ApiError(detail, res.status);
}

export async function getAgenda(): Promise<AgendaResponse> {
  const res = await fetch(`${BASE_URL}/api/agenda`);
  if (!res.ok) {
    return parseAgendaError(res, `GET /api/agenda failed with ${res.status}`);
  }
  return (await res.json()) as AgendaResponse;
}

export async function postAgendaTopic(body: AgendaTopicRequest): Promise<AgendaResponse> {
  const res = await fetch(`${BASE_URL}/api/agenda/topic`, {
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
  const res = await fetch(`${BASE_URL}/api/agenda/topic/action`, {
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
  const res = await fetch(`${BASE_URL}/api/agenda/session`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    return parseAgendaError(res, `PUT /api/agenda/session failed with ${res.status}`);
  }
  return (await res.json()) as AgendaResponse;
}

export function useAgendaQuery() {
  return useQuery({
    queryKey: AGENDA_QUERY_KEY,
    queryFn: getAgenda
  });
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
