import { useEffect, useRef } from "react";
import { getSpeechProgress } from "./client.js";
import { useSpeechProgressStore } from "../store/speechProgressStore.js";
import { queryClient } from "./queryClient.js";
import { LAST_REPLY_QUERY_KEY } from "./chat.js";

const ACTIVE_POLL_INTERVAL_MS = 80;
const IDLE_POLL_INTERVAL_MS = 300;

/**
 * Autonomous adaptive live poll for sentence reading sync.
 * - While speaking: high cadence (80ms) for real-time text highlight tracking.
 * - While idle: lightweight cadence (300ms) with zero heavy queries or subscriptions.
 * Mounted once in EventBridge.
 */
export function useSpeechProgressSync(): void {
  const setProgress = useSpeechProgressStore((s) => s.setProgress);
  const reset = useSpeechProgressStore((s) => s.reset);
  const inFlightRef = useRef(false);
  const isSpeakingRef = useRef(false);
  const lastJobIdRef = useRef<number | null>(null);

  useEffect(() => {
    let mounted = true;
    let timerId: ReturnType<typeof setTimeout> | null = null;

    const poll = async () => {
      if (!mounted) return;
      if (inFlightRef.current) {
        scheduleNext();
        return;
      }
      inFlightRef.current = true;
      try {
        const data = await getSpeechProgress();
        if (!mounted) return;
        if (data.speaking) {
          const wasSpeaking = isSpeakingRef.current;
          isSpeakingRef.current = true;
          // Highlight identity comes from feed_turn_id only; the legacy turn_id
          // is a vision-read token and must never reach the store.
          const jobId = data.job_id ?? null;
          const jobChanged = wasSpeaking && jobId !== lastJobIdRef.current;
          lastJobIdRef.current = jobId;
          setProgress(true, data.current_idx, data.total, data.feed_turn_id ?? null, {
            jobId,
            fragment: data.fragment ?? null
          });
          if (!wasSpeaking || jobChanged) {
            void queryClient.invalidateQueries({ queryKey: LAST_REPLY_QUERY_KEY });
          }
        } else {
          if (isSpeakingRef.current) {
            isSpeakingRef.current = false;
            lastJobIdRef.current = null;
            reset();
            void queryClient.invalidateQueries({ queryKey: LAST_REPLY_QUERY_KEY });
          }
        }
      } catch {
        // Silently tolerate transient network hiccups
      } finally {
        inFlightRef.current = false;
        scheduleNext();
      }
    };

    const scheduleNext = () => {
      if (!mounted) return;
      if (timerId) clearTimeout(timerId);
      const interval = isSpeakingRef.current ? ACTIVE_POLL_INTERVAL_MS : IDLE_POLL_INTERVAL_MS;
      timerId = setTimeout(poll, interval);
    };

    // Initial poll on mount
    poll();

    return () => {
      mounted = false;
      if (timerId) clearTimeout(timerId);
    };
  }, [setProgress, reset]);
}
