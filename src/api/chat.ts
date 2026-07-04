import { useCallback, useRef } from "react";
import { useMutation } from "@tanstack/react-query";
import { postChatTurn } from "./client.js";

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
