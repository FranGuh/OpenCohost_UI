import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "../../ui/Toast.js";
import { setToastSink, subscribeMutationEvents } from "../../lib/appEvents.js";
import { useServerEventLog } from "../../api/events.js";
import { usePttFocusReporter, usePttServerSignal, usePttStateQuery } from "../../api/ptt.js";
import { useSpeechProgressSync } from "../../api/speechProgress.js";

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
  // external PTT bridge is invisible to both. One owner here, mounted for the
  // whole session, feeds the avatar's "escuchando" state from server truth.
  usePttServerSignal();
  // ptt-dictation-20261111: MAIN window focus for the `foreground` dictation
  // mode. EventBridge is never mounted in the desktop companion webview, so the
  // companion can never report "main window focused".
  usePttFocusReporter();
  // Live TTS sentence sync tracking: polls at 100ms only while speaking
  useSpeechProgressSync();
  const pttState = usePttStateQuery();
  const activeHotkey = pttState.data?.hotkey ?? "F10";

  useEffect(() => {
    setToastSink((message, tone) => toast(message, { tone, duration: 3000 }));
    const unsubscribe = subscribeMutationEvents(queryClient);

    const handleKeyDown = (e: KeyboardEvent) => {
      // Windows default behavior for F10 activates the window menu bar (WM_SYSCOMMAND / SC_KEYMENU),
      // which steals focus from WebView2 and causes Chromium to throttle background timers/React state.
      // Also block accidental browser actions (F1 Windows help, F5 / Ctrl+R page reload) and the active PTT hotkey.
      const isReload = e.key === "F5" || (e.ctrlKey && e.key.toLowerCase() === "r");
      if (e.key === "F10" || e.key === "F1" || isReload || e.key === activeHotkey) {
        e.preventDefault();
      }
    };
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      setToastSink(null);
      unsubscribe();
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [activeHotkey, queryClient, toast]);

  return null;
}
