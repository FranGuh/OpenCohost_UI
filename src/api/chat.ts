import { useCallback, useRef } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { getLastReply, getLastReplyByTurn, postChatTurn, type ChatTurnImage } from "./client.js";
import { useSpeechProgressStore } from "../store/speechProgressStore.js";
import { queryClient } from "./queryClient.js";

export const LAST_REPLY_QUERY_KEY = ["chat", "last-reply"] as const;

/**
 * GET /api/chat/last-reply poll (spec P3/S3): `text === null` means no reply
 * has landed yet. Polls adaptively: high cadence (100ms) while speech is active
 * or when the backend is streaming response fragments, quiet (1200ms) while idle.
 */
export function useLastReply() {
  const speaking = useSpeechProgressStore((s) => s.speaking);
  return useQuery({
    queryKey: LAST_REPLY_QUERY_KEY,
    queryFn: getLastReply,
    refetchInterval: (query) => {
      if (speaking || query.state.data?.is_streaming) {
        return 100;
      }
      return 1200;
    },
    // Stays live while backgrounded — see status.ts / backgroundPolling.test.ts.
    refetchIntervalInBackground: true
  });
}

/**
 * Fragments of one specific recent turn (`?turn_id=N`), fetched only when the
 * spoken turn's fragments are missing or stale in the feed. `null` data means
 * the backend no longer has the turn (404): no highlight, no error. `version`
 * (e.g. the job's fragment count) is part of the key so a changed turn refetches.
 */
export function useLastReplyByTurn(turnId: number | null, enabled: boolean, version: number) {
  return useQuery({
    queryKey: [...LAST_REPLY_QUERY_KEY, "turn", turnId, version] as const,
    queryFn: () => getLastReplyByTurn(turnId as number),
    enabled: enabled && turnId !== null,
    retry: false,
    staleTime: 5000
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
    mutationFn: ({ text, image }: { text: string; image?: ChatTurnImage | readonly ChatTurnImage[] }) => {
      // The images are part of the intent: swapping, adding or removing one is an edit too.
      const list: readonly ChatTurnImage[] = image === undefined ? [] : "data" in image ? [image] : image;
      const signature = list.length
        ? text + "\u0000" + list.map((one) => `${one.mime_type}:${one.data.length}:${one.data.slice(-24)}`).join("|")
        : text;
      if (lastTextRef.current !== null && lastTextRef.current !== signature) {
        keyRef.current = crypto.randomUUID();
      }
      lastTextRef.current = signature;
      return postChatTurn(text, keyRef.current, image);
    },
    onMutate: () => {
      void queryClient.invalidateQueries({ queryKey: LAST_REPLY_QUERY_KEY });
    },
    onSuccess: () => {
      keyRef.current = crypto.randomUUID();
      // A fresh key is already in place, so the next send is a new intent no
      // matter what it says — nothing left to compare against.
      lastTextRef.current = null;
      void queryClient.invalidateQueries({ queryKey: LAST_REPLY_QUERY_KEY });
    }
  });

  const send = useCallback(
    (text: string, image?: ChatTurnImage | readonly ChatTurnImage[]) => mutation.mutateAsync({ text, image }),
    [mutation]
  );

  return {
    send,
    pending: mutation.isPending,
    isError: mutation.isError,
    error: mutation.error,
    reset: mutation.reset
  };
}
