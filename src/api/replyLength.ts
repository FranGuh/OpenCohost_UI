import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError, authFetch, getApiBaseUrl } from "./client.js";

/**
 * Reply length endpoint (opencohost/api/routers/reply_length.py) is newer than
 * the OpenAPI snapshot, so this module is hand-typed, the same self-contained
 * pattern as src/api/guardrails.ts.
 *
 * Errors: 422 `invalid_reply_length`, 503 `reply_length_write_failed`. Both
 * surface as a plain ApiError carrying the status.
 */

export const REPLY_LENGTH_MODES = ["auto", "short", "medium", "long", "very_long"] as const;
export type ReplyLengthMode = (typeof REPLY_LENGTH_MODES)[number];

export interface ReplyLengthResponse {
  mode: ReplyLengthMode;
}

const PATH = "/api/reply-length";

export async function getReplyLength(): Promise<ReplyLengthResponse> {
  const res = await authFetch(`${getApiBaseUrl()}${PATH}`);
  if (!res.ok) {
    throw new ApiError(`GET ${PATH} failed with ${res.status}`, res.status);
  }
  return (await res.json()) as ReplyLengthResponse;
}

export async function putReplyLength(mode: ReplyLengthMode): Promise<ReplyLengthResponse> {
  const res = await authFetch(`${getApiBaseUrl()}${PATH}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mode })
  });
  if (!res.ok) {
    throw new ApiError(`PUT ${PATH} failed with ${res.status}`, res.status);
  }
  return (await res.json()) as ReplyLengthResponse;
}

export const REPLY_LENGTH_QUERY_KEY = ["reply-length"] as const;

export function useReplyLengthQuery() {
  return useQuery({ queryKey: REPLY_LENGTH_QUERY_KEY, queryFn: getReplyLength });
}

/**
 * Optimistic save: the cache flips immediately, rolls back to the snapshot on
 * any failure, and is replaced by the server's response on success.
 */
export function useReplyLengthSave() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: putReplyLength,
    onMutate: async (mode: ReplyLengthMode) => {
      await queryClient.cancelQueries({ queryKey: REPLY_LENGTH_QUERY_KEY });
      const previous = queryClient.getQueryData<ReplyLengthResponse>(REPLY_LENGTH_QUERY_KEY);
      queryClient.setQueryData<ReplyLengthResponse>(REPLY_LENGTH_QUERY_KEY, { mode });
      return { previous };
    },
    onError: (_error, _mode, context) => {
      if (context?.previous) queryClient.setQueryData(REPLY_LENGTH_QUERY_KEY, context.previous);
    },
    onSuccess: (saved) => queryClient.setQueryData(REPLY_LENGTH_QUERY_KEY, saved)
  });
}
