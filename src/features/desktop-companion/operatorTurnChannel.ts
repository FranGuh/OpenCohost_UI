const CHANNEL_NAME = "opencohost-companion-operator-turn";

export interface AcceptedCompanionTurn {
  type: "operator-turn-accepted";
  id: string;
  text: string;
  ts: number;
}

function openChannel(): BroadcastChannel | null {
  try {
    return typeof window.BroadcastChannel === "function" ? new window.BroadcastChannel(CHANNEL_NAME) : null;
  } catch {
    return null;
  }
}

export function publishAcceptedCompanionTurn(turn: AcceptedCompanionTurn): void {
  const channel = openChannel();
  if (!channel) return;
  try {
    channel.postMessage(turn);
  } catch {
    // The accepted POST must not become a send error if local notification fails.
  } finally {
    channel.close();
  }
}

export function subscribeAcceptedCompanionTurns(onTurn: (turn: AcceptedCompanionTurn) => void): () => void {
  const channel = openChannel();
  if (!channel) return () => {};
  const handleMessage = (event: MessageEvent<unknown>) => {
    const turn = event.data;
    if (!turn || typeof turn !== "object") return;
    const candidate = turn as Partial<AcceptedCompanionTurn>;
    if (
      candidate.type !== "operator-turn-accepted" ||
      typeof candidate.id !== "string" || !candidate.id ||
      typeof candidate.text !== "string" || !candidate.text ||
      typeof candidate.ts !== "number" || !Number.isFinite(candidate.ts)
    ) return;
    onTurn(candidate as AcceptedCompanionTurn);
  };
  channel.addEventListener("message", handleMessage);
  return () => {
    channel.removeEventListener("message", handleMessage);
    channel.close();
  };
}
