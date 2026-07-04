import { useCallback, useRef } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { getLastReply, postChatTurn } from "./client.js";

export const LAST_REPLY_QUERY_KEY = ["chat", "last-reply"] as const;

/**
 * GET /api/chat/last-reply poll (spec P3/S3): `text === null` means no reply
 * has landed yet. Same polling shape as useStatusQuery — plain interval, no
 * convergence logic needed here (there's no "target" to converge on, just
 * "did a new reply arrive").
 */
export function useLastReply() {
  return useQuery({
    queryKey: LAST_REPLY_QUERY_KEY,
    queryFn: getLastReply,
    refetchInterval: 1500,
    refetchIntervalInBackground: false
  });
}

/**
 * Chat turn send (spec R8): fire-and-forget POST /api/chat/turn. There is no
 * reply to read back — Kira's reply is audio-only, observed via
 * is_speaking/deriveAvatarState on the status poll, never returned here.
 *
 * Idempotency-Key: one key per in-flight intent, rotated only after a
 * successful accept (that intent is done; the next send is a new one). Kept
 * stable across an error so a manual retry replays/dedupes the SAME intent
 * instead of the backend seeing it as a brand-new turn.
 */
export function useSendChatTurn() {
  const keyRef = useRef<string>(crypto.randomUUID());

  const mutation = useMutation({
    mutationFn: (text: string) => postChatTurn(text, keyRef.current),
    onSuccess: () => {
      keyRef.current = crypto.randomUUID();
    }
  });

  const send = useCallback((text: string) => mutation.mutateAsync(text), [mutation]);

  return {
    send,
    pending: mutation.isPending,
    isError: mutation.isError,
    error: mutation.error,
    reset: mutation.reset
  };
}
