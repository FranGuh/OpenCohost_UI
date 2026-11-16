import { create } from "zustand";

export interface SpeechProgressExtra {
  jobId?: number | null;
  fragment?: string | null;
}

export interface SpeechProgressState {
  speaking: boolean;
  /** Reply-feed turn being spoken (backend `feed_turn_id`). Never the vision-read `turn_id`. */
  feedTurnId: number | null;
  currentIdx: number | null;
  total: number;
  /** Monotonic speech job id; a change means a new/replacement job. */
  jobId: number | null;
  /** Exact TTS fragment playing now (backend `fragment`). */
  fragment: string | null;
  /** Incremented every time `jobId` changes; lets views drop job-scoped state. */
  jobEpoch: number;
  setProgress: (
    speaking: boolean,
    currentIdx: number | null,
    total: number,
    feedTurnId?: number | null,
    extra?: SpeechProgressExtra
  ) => void;
  reset: () => void;
}

export const useSpeechProgressStore = create<SpeechProgressState>((set, get) => ({
  speaking: false,
  feedTurnId: null,
  currentIdx: null,
  total: 0,
  jobId: null,
  fragment: null,
  jobEpoch: 0,
  setProgress: (speaking, currentIdx, total, feedTurnId = null, extra = {}) => {
    const current = get();
    const jobId = extra.jobId ?? null;
    const fragment = extra.fragment ?? null;
    if (
      current.speaking === speaking &&
      current.currentIdx === currentIdx &&
      current.total === total &&
      current.feedTurnId === feedTurnId &&
      current.jobId === jobId &&
      current.fragment === fragment
    ) {
      return;
    }
    // Every field is replaced wholesale, so nothing from the previous job
    // survives a job change; the epoch tells views to drop their own state.
    set({
      speaking,
      currentIdx,
      total,
      feedTurnId,
      jobId,
      fragment,
      jobEpoch: jobId !== current.jobId ? current.jobEpoch + 1 : current.jobEpoch,
    });
  },
  reset: () => {
    const current = get();
    if (
      !current.speaking &&
      current.currentIdx === null &&
      current.total === 0 &&
      current.feedTurnId === null &&
      current.jobId === null &&
      current.fragment === null
    ) {
      return;
    }
    set({
      speaking: false,
      currentIdx: null,
      total: 0,
      feedTurnId: null,
      jobId: null,
      fragment: null,
      jobEpoch: current.jobEpoch + 1,
    });
  },
}));
