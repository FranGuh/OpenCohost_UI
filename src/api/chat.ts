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
    // Stays live while backgrounded — see status.ts / backgroundPolling.test.ts.
    refetchIntervalInBackground: true
  });
}

/**
 * Chat turn send (spec R8): fire-and-forget POST /api/chat/turn. There is no
 * reply to read back — Kira's reply is audio-only, observed via
 * is_speaking/deriveAvatarState on the status poll, never returned here.
 *
 * Idempotency-Key: one key per in-flight INTENT, rotated after a successful
 * accept (that intent is done) and also when the operator EDITS the text
 * after a failure. Kept stable across a verbatim retry so the backend
 * replays/dedupes the SAME intent instead of seeing a brand-new turn.
 *
 * The edit case is why `lastTextRef` exists. `_dedupe_key` in
 * opencohost/api/dispatch.py rejects a second request that reuses a key with a
 * DIFFERENT payload — it returns `conflict` (409), and the record lives for the
 * full 600s TTL (dispatch.py:24). Without rotation, one failed send followed by
 * "let me reword that" bricked the composer for ten minutes. Rotating trades
 * that lockout for the possibility of a double answer if the original turn did
 * land after all, which is the better failure.
 */
export function useSendChatTurn() {
  const keyRef = useRef<string>(crypto.randomUUID());
  const lastTextRef = useRef<string | null>(null);

  const mutation = useMutation({
    mutationFn: (text: string) => {
      if (lastTextRef.current !== null && lastTextRef.current !== text) {
        keyRef.current = crypto.randomUUID();
      }
      lastTextRef.current = text;
      return postChatTurn(text, keyRef.current);
    },
    onSuccess: () => {
      keyRef.current = crypto.randomUUID();
      // A fresh key is already in place, so the next send is a new intent no
      // matter what it says — nothing left to compare against.
      lastTextRef.current = null;
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
