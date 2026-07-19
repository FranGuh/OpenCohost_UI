import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError, ConflictError, ValidationError, authFetch, getApiBaseUrl } from "./client.js";

/**
 * GET /api/stream/chat-live + POST .../connect + POST .../disconnect + PUT
 * .../limits (opencohost/api/main.py ~549-624) predate types.gen.ts's
 * OpenAPI generation, so they have no generated type — hand-typed from
 * opencohost/api/models.py::StreamChatLiveResponse/StreamConnectRequest/
 * StreamLimitsRequest. R8-CRITICAL: STATE + LIMITS ONLY, never add a field
 * carrying viewer message text — this must never surface raw viewer chat.
 * ponytail: keep in sync manually if those models change.
 */
export interface StreamChatLiveResponse {
  connected: boolean;
  platform: string | null;
  source_id: string | null;
  threshold_per_second: number;
  cooldown_seconds: number;
  max_messages_per_user: number;
  filter_policy: string;
}

export interface StreamLimitsRequest {
  threshold_per_second?: number;
  cooldown_seconds?: number;
  max_messages_per_user?: number;
  filter_policy?: string;
}

export const STREAM_CHAT_LIVE_QUERY_KEY = ["stream-chat-live"] as const;

export async function getStreamChatLive(): Promise<StreamChatLiveResponse> {
  const res = await fetch(`${getApiBaseUrl()}/api/stream/chat-live`);
  if (!res.ok) {
    throw new ApiError(`GET /api/stream/chat-live failed with ${res.status}`, res.status);
  }
  return (await res.json()) as StreamChatLiveResponse;
}

export async function postStreamConnect(url: string): Promise<StreamChatLiveResponse> {
  const res = await authFetch(`${getApiBaseUrl()}/api/stream/chat-live/connect`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url })
  });

  if (res.status === 409) {
    throw new ConflictError("stream connect busy");
  }
  if (res.status === 422) {
    // Lote C: backend now sends `invalid_url` (bad URL shape) OR
    // `unsupported_platform` (aggregator rejected the platform). Both are
    // ValidationErrors; errorCopy maps the KNOWN codes to voseo copy.
    let detail = "invalid_url";
    try {
      const body = (await res.json()) as { detail?: string };
      detail = body.detail ?? detail;
    } catch {
      // non-JSON 422 body — fall back to a generic message.
    }
    throw new ValidationError(detail);
  }
  if (res.status === 503) {
    // Lote C: `chat_source_unavailable` (connector not installed) vs
    // `stream_unavailable` (no aggregator / unexpected failure). Carry the
    // CODE as the ApiError message so errorCopy can name the right cause —
    // never a raw traceback (R8/F4).
    let detail = "stream_unavailable";
    try {
      const body = (await res.json()) as { detail?: string };
      detail = body.detail ?? detail;
    } catch {
      // non-JSON 503 body — fall back to the generic code.
    }
    throw new ApiError(detail, 503);
  }
  if (!res.ok) {
    throw new ApiError(`POST /api/stream/chat-live/connect failed with ${res.status}`, res.status);
  }
  return (await res.json()) as StreamChatLiveResponse;
}

/**
 * Thrown by `connectStreamAndAwait` when the connect POST succeeded but the
 * chat never reported `connected:true` within the poll budget — i.e. the
 * directo probably is not actually live. Distinct type so `errorCopy` can
 * produce the "verificá que esté EN VIVO" copy instead of a generic retry.
 */
export class StreamConnectTimeoutError extends Error {
  constructor(message = "stream_connect_timeout") {
    super(message);
    this.name = "StreamConnectTimeoutError";
  }
}

export interface StreamConnectPollOptions {
  /** Status polls AFTER the initial POST (default 7 ≈ 5.6s @ 800ms). */
  attempts?: number;
  /** Delay between polls in ms (default 800). */
  intervalMs?: number;
  /** Injected sleep — tests pass a no-op to run instantly. */
  sleep?: (ms: number) => Promise<void>;
  /** Injected status reader — tests stub this. */
  getStatus?: () => Promise<StreamChatLiveResponse>;
}

/**
 * Lote C — honest connect: POST connect, then poll GET /api/stream/chat-live
 * until `connected:true` or the budget runs out. The backend launches the real
 * connection on a daemon thread, so the POST almost always returns
 * `connected:false` a beat before the socket is up; polling is what makes the
 * /vivo ack honest instead of the near-guaranteed false negative the raw POST
 * response gave. Connect errors (422/409/503) propagate unchanged; budget
 * exhaustion throws `StreamConnectTimeoutError`.
 */
export async function connectStreamAndAwait(
  url: string,
  opts: StreamConnectPollOptions = {}
): Promise<StreamChatLiveResponse> {
  const attempts = opts.attempts ?? 7;
  const intervalMs = opts.intervalMs ?? 800;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const getStatus = opts.getStatus ?? getStreamChatLive;

  const initial = await postStreamConnect(url);
  if (initial.connected) return initial;

  for (let i = 0; i < attempts; i++) {
    await sleep(intervalMs);
    const status = await getStatus();
    if (status.connected) return status;
  }
  throw new StreamConnectTimeoutError();
}

export async function postStreamDisconnect(): Promise<StreamChatLiveResponse> {
  const res = await authFetch(`${getApiBaseUrl()}/api/stream/chat-live/disconnect`, { method: "POST" });

  if (res.status === 409) {
    throw new ConflictError("stream disconnect busy");
  }
  if (!res.ok) {
    throw new ApiError(`POST /api/stream/chat-live/disconnect failed with ${res.status}`, res.status);
  }
  return (await res.json()) as StreamChatLiveResponse;
}

export async function putStreamLimits(body: StreamLimitsRequest): Promise<StreamChatLiveResponse> {
  const res = await authFetch(`${getApiBaseUrl()}/api/stream/chat-live/limits`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });

  if (res.status === 422) {
    let detail = "invalid_filter_policy";
    try {
      const errBody = (await res.json()) as { detail?: string };
      detail = errBody.detail ?? detail;
    } catch {
      // non-JSON 422 body — fall back to a generic message.
    }
    throw new ValidationError(detail);
  }
  if (!res.ok) {
    throw new ApiError(`PUT /api/stream/chat-live/limits failed with ${res.status}`, res.status);
  }
  return (await res.json()) as StreamChatLiveResponse;
}

export function useStreamChatLiveQuery() {
  return useQuery({
    queryKey: STREAM_CHAT_LIVE_QUERY_KEY,
    queryFn: getStreamChatLive
  });
}

export function useStreamConnectMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: postStreamConnect,
    meta: { event: { source: "stream", action: "connect" } }, // NO url — may embed channel identifiers
    onSuccess: (data) => {
      queryClient.setQueryData(STREAM_CHAT_LIVE_QUERY_KEY, data);
    }
  });
}

export function useStreamDisconnectMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: postStreamDisconnect,
    meta: { event: { source: "stream", action: "disconnect", tone: "neutral" } },
    onSuccess: (data) => {
      queryClient.setQueryData(STREAM_CHAT_LIVE_QUERY_KEY, data);
    }
  });
}

export function useStreamLimitsMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: putStreamLimits,
    meta: { event: { source: "stream", action: "limits" } },
    onSuccess: (data) => {
      queryClient.setQueryData(STREAM_CHAT_LIVE_QUERY_KEY, data);
    }
  });
}
