import { create } from "zustand";

export const CHAT_STATS_STORAGE_KEY = "oc-chat-stats-v1";

export interface ChatStatsData {
  searchesCount: number;
  profileTurns: Record<string, number>;
  totalTurns: number;
  latencySumMs: number;
  latencyCount: number;
  modelUsage: Record<string, number>;
  longestSessionMs: number;
}

export interface ChatStatsStore extends ChatStatsData {
  sessionStartTime: number;
  accumulatedActiveMs: number;
  activeSegmentStart: number | null;
  updateModelActiveState: (isActive: boolean) => void;
  recordTurn: (profileId?: string, model?: string, latencyMs?: number) => void;
  recordSearch: () => void;
  getProfileTurns: (profileId?: string) => number;
  getAvgLatencyMs: () => number | null;
  getFavoriteModel: () => string | null;
  getSessionDurationSeconds: () => number;
  resetAll: () => void;
}

const DEFAULT_STATS: ChatStatsData = {
  searchesCount: 0,
  profileTurns: {},
  totalTurns: 0,
  latencySumMs: 0,
  latencyCount: 0,
  modelUsage: {},
  longestSessionMs: 0,
};

function readStoredStats(): ChatStatsData {
  try {
    const raw = window.localStorage.getItem(CHAT_STATS_STORAGE_KEY);
    if (!raw) return DEFAULT_STATS;
    const parsed = JSON.parse(raw);
    return {
      searchesCount: typeof parsed.searchesCount === "number" ? parsed.searchesCount : 0,
      profileTurns: typeof parsed.profileTurns === "object" && parsed.profileTurns !== null ? parsed.profileTurns : {},
      totalTurns: typeof parsed.totalTurns === "number" ? parsed.totalTurns : 0,
      latencySumMs: typeof parsed.latencySumMs === "number" ? parsed.latencySumMs : 0,
      latencyCount: typeof parsed.latencyCount === "number" ? parsed.latencyCount : 0,
      modelUsage: typeof parsed.modelUsage === "object" && parsed.modelUsage !== null ? parsed.modelUsage : {},
      longestSessionMs: typeof parsed.longestSessionMs === "number" ? parsed.longestSessionMs : 0,
    };
  } catch {
    return DEFAULT_STATS;
  }
}

function persistStats(data: ChatStatsData): void {
  try {
    window.localStorage.setItem(CHAT_STATS_STORAGE_KEY, JSON.stringify(data));
  } catch {
    // Storage is best-effort; in-memory state remains valid
  }
}

export const useChatStatsStore = create<ChatStatsStore>((set, get) => {
  const initialData = readStoredStats();
  const sessionStartTime = Date.now();

  return {
    ...initialData,
    sessionStartTime,
    accumulatedActiveMs: 0,
    activeSegmentStart: null,

    updateModelActiveState: (isActive: boolean) => {
      set((state) => {
        const now = Date.now();
        if (!isActive && state.activeSegmentStart !== null) {
          const segmentDuration = now - state.activeSegmentStart;
          return {
            activeSegmentStart: null,
            accumulatedActiveMs: state.accumulatedActiveMs + Math.max(0, segmentDuration),
          };
        }
        if (isActive && state.activeSegmentStart === null) {
          return {
            activeSegmentStart: now,
          };
        }
        return {};
      });
    },

    recordTurn: (profileId?: string, model?: string, latencyMs?: number) => {
      set((state) => {
        const nextTotalTurns = state.totalTurns + 1;
        const nextProfileTurns = { ...state.profileTurns };
        if (profileId) {
          nextProfileTurns[profileId] = (nextProfileTurns[profileId] || 0) + 1;
        }

        const nextModelUsage = { ...state.modelUsage };
        if (model) {
          nextModelUsage[model] = (nextModelUsage[model] || 0) + 1;
        }

        const nextLatencySum = latencyMs && latencyMs > 0 ? state.latencySumMs + latencyMs : state.latencySumMs;
        const nextLatencyCount = latencyMs && latencyMs > 0 ? state.latencyCount + 1 : state.latencyCount;

        const currentSessionElapsed = Date.now() - state.sessionStartTime;
        const nextLongestSession = Math.max(state.longestSessionMs, currentSessionElapsed);

        const nextData: ChatStatsData = {
          searchesCount: state.searchesCount,
          profileTurns: nextProfileTurns,
          totalTurns: nextTotalTurns,
          latencySumMs: nextLatencySum,
          latencyCount: nextLatencyCount,
          modelUsage: nextModelUsage,
          longestSessionMs: nextLongestSession,
        };

        persistStats(nextData);

        return {
          ...nextData,
        };
      });
    },

    recordSearch: () => {
      set((state) => {
        const nextData: ChatStatsData = {
          ...state,
          searchesCount: state.searchesCount + 1,
        };
        persistStats(nextData);
        return { searchesCount: nextData.searchesCount };
      });
    },

    getProfileTurns: (profileId?: string) => {
      const state = get();
      if (!profileId) return state.totalTurns;
      return state.profileTurns[profileId] ?? 0;
    },

    getAvgLatencyMs: () => {
      const state = get();
      if (state.latencyCount === 0) return null;
      return Math.round(state.latencySumMs / state.latencyCount);
    },

    getFavoriteModel: () => {
      const state = get();
      let bestModel: string | null = null;
      let maxCount = 0;
      for (const [model, count] of Object.entries(state.modelUsage)) {
        if (count > maxCount) {
          maxCount = count;
          bestModel = model;
        }
      }
      return bestModel;
    },

    getSessionDurationSeconds: () => {
      const state = get();
      if (state.activeSegmentStart !== null) {
        return Math.floor((state.accumulatedActiveMs + Math.max(0, Date.now() - state.activeSegmentStart)) / 1000);
      }
      return Math.floor(state.accumulatedActiveMs / 1000);
    },

    resetAll: () => {
      persistStats(DEFAULT_STATS);
      set({
        ...DEFAULT_STATS,
        sessionStartTime: Date.now(),
        accumulatedActiveMs: 0,
        activeSegmentStart: null,
      });
    },
  };
});
