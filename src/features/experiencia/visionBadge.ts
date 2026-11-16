import type { VisionMode, VisionResult } from "../../store/visionStore.js";

export interface VisionBadge {
  outcome: string;
  describeMs: number | null;
  lookId?: string | null;
  framesSent?: number | null;
  mode?: VisionMode | null;
}

interface BadgeTurn {
  id: string;
  role?: "operator" | "kira";
  text?: string;
  ts?: number;
  fromAgenda?: boolean;
}

/** A reply later than this after the look is not "the reply to that look". */
const MAX_REPLY_LAG_MS = 3 * 60_000;

/**
 * Correlate look results with Kira replies by time, no ids needed: the backend
 * runs the look at the start of the turn, so a `vision_result` always precedes
 * the reply it served. A result badges the FIRST real Kira reply (chat, not
 * agenda, not the thinking placeholder) whose server `ts` is at or after it,
 * within MAX_REPLY_LAG_MS; when two results precede one reply the latest wins.
 * Both timestamps are server clock (event `ts`, last-reply `ts`).
 */
export function attachVisionBadges(turns: readonly BadgeTurn[], results: readonly VisionResult[]): Map<string, VisionBadge> {
  const replies = turns.filter((t) => t.role === "kira" && t.text !== undefined && !t.fromAgenda && t.ts !== undefined);
  const out = new Map<string, VisionBadge>();
  for (const result of [...results].sort((a, b) => a.ts - b.ts)) {
    const reply = replies.find((t) => (t.ts as number) >= result.ts);
    if (reply && (reply.ts as number) - result.ts <= MAX_REPLY_LAG_MS) {
      out.set(reply.id, { outcome: result.outcome, describeMs: result.describeMs, lookId: result.lookId, framesSent: result.framesSent, mode: result.mode });
    }
  }
  return out;
}
