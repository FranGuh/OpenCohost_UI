import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "./ui/Toast.js";
import { setToastSink, subscribeMutationEvents } from "../lib/appEvents.js";
import { useServerEventLog } from "../api/events.js";
import { usePttServerSignal } from "../api/ptt.js";

/** Renders nothing, holds no state — exists only to hand the EXISTING toast
 * system to appEvents.ts and install the single MutationCache subscriber
 * (item A) plus the engine event-log poll (item B). StrictMode double-mount
 * is safe: the cleanup unsubscribes symmetrically, and the store dedups by
 * id as a second guard. */
export function EventBridge() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  useServerEventLog();
  // App-wide, deliberately NOT inside a panel: KiraCover lives in the
  // "experiencia" section while the PTT card lives in "controles", and the
  // external F10 bridge is invisible to both. One owner here, mounted for the
  // whole session, feeds the avatar's "escuchando" state from server truth.
  usePttServerSignal();

  useEffect(() => {
    setToastSink((message, tone) => toast(message, { tone, duration: 3000 }));
    const unsubscribe = subscribeMutationEvents(queryClient);
    return () => {
      setToastSink(null);
      unsubscribe();
    };
  }, [queryClient, toast]);

  return null;
}
