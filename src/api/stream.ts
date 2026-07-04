import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError, ConflictError, ValidationError } from "./client.js";

const BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://127.0.0.1:8000";

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
  const res = await fetch(`${BASE_URL}/api/stream/chat-live`);
  if (!res.ok) {
    throw new ApiError(`GET /api/stream/chat-live failed with ${res.status}`, res.status);
  }
  return (await res.json()) as StreamChatLiveResponse;
}

export async function postStreamConnect(url: string): Promise<StreamChatLiveResponse> {
  const res = await fetch(`${BASE_URL}/api/stream/chat-live/connect`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url })
  });

  if (res.status === 409) {
    throw new ConflictError("stream connect busy");
  }
  if (res.status === 422) {
    let detail = "invalid_url";
    try {
      const body = (await res.json()) as { detail?: string };
      detail = body.detail ?? detail;
    } catch {
      // non-JSON 422 body — fall back to a generic message.
    }
    throw new ValidationError(detail);
  }
  if (!res.ok) {
    throw new ApiError(`POST /api/stream/chat-live/connect failed with ${res.status}`, res.status);
  }
  return (await res.json()) as StreamChatLiveResponse;
}

export async function postStreamDisconnect(): Promise<StreamChatLiveResponse> {
  const res = await fetch(`${BASE_URL}/api/stream/chat-live/disconnect`, { method: "POST" });

  if (res.status === 409) {
    throw new ConflictError("stream disconnect busy");
  }
  if (!res.ok) {
    throw new ApiError(`POST /api/stream/chat-live/disconnect failed with ${res.status}`, res.status);
  }
  return (await res.json()) as StreamChatLiveResponse;
}

export async function putStreamLimits(body: StreamLimitsRequest): Promise<StreamChatLiveResponse> {
  const res = await fetch(`${BASE_URL}/api/stream/chat-live/limits`, {
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
    onSuccess: (data) => {
      queryClient.setQueryData(STREAM_CHAT_LIVE_QUERY_KEY, data);
    }
  });
}

export function useStreamDisconnectMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: postStreamDisconnect,
    onSuccess: (data) => {
      queryClient.setQueryData(STREAM_CHAT_LIVE_QUERY_KEY, data);
    }
  });
}

export function useStreamLimitsMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: putStreamLimits,
    onSuccess: (data) => {
      queryClient.setQueryData(STREAM_CHAT_LIVE_QUERY_KEY, data);
    }
  });
}
