import { visionReadiness, type VisionResponse } from "../api/vision.js";

/**
 * Composer look commands: `/mira`, `!mira`, `/look`, `!look` (case-insensitive,
 * followed by whitespace or end of input). Returns the message that should be
 * sent after arming the look (`rest`, possibly empty), or null when the text is
 * not a look command. Pure: the caller arms the look and decides what to send.
 *
 * V1.26/V1.27: an optional mode word right after the command picks the look
 * shape: `clip`/`video` (6-frame mosaic) or `texto`/`text`/`lee` (one frame at
 * full quality). It is stripped from `rest`; without it the mode is omitted.
 */
const VISION_COMMAND = /^[/!](?:mira|look)(?:\s+([\s\S]*))?$/i;

const MODE_WORD = /^(clip|video|vídeo|texto|text|lee)(?:\s+([\s\S]*))?$/i;

export type VisionLookMode = "clip" | "text";

export interface VisionCommand {
  rest: string;
  mode?: VisionLookMode;
}

export function parseVisionCommand(text: string): VisionCommand | null {
  const match = VISION_COMMAND.exec(text.trim());
  if (!match) return null;
  const rest = (match[1] ?? "").trim();
  const modeMatch = MODE_WORD.exec(rest);
  if (!modeMatch) return { rest };
  const word = modeMatch[1].toLowerCase();
  const mode: VisionLookMode = word === "clip" || word === "video" || word === "vídeo" ? "clip" : "text";
  return { rest: (modeMatch[2] ?? "").trim(), mode };
}

/** True when a composer draft targets the slash/bang command palette rather than a look command. */
export function isComposerCommandPrefix(text: string): boolean {
  return /^[/!]/.test(text.trim()) && parseVisionCommand(text) === null;
}

/** Validates readiness and arms the one-shot vision look before optional remainder chat submission. */
export async function executeVisionCommand(
  command: VisionCommand,
  params: {
    visionData: VisionResponse | undefined;
    armLook: (mode?: VisionLookMode) => Promise<unknown>;
  }
): Promise<{ ok: true; rest: string } | { ok: false }> {
  if (visionReadiness(params.visionData) !== "ready") {
    return { ok: false };
  }
  try {
    await params.armLook(command.mode);
  } catch {
    return { ok: false };
  }
  return { ok: true, rest: command.rest };
}
