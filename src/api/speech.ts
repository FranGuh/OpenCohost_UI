import { useCallback, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError, ValidationError, authFetch, getApiBaseUrl } from "./client.js";

/**
 * Read-aloud endpoints (opencohost/api/routers/speech.py) are newer than the
 * OpenAPI snapshot, so this module is hand-typed end to end, the same
 * self-contained pattern as src/api/ptt.ts.
 *
 * PRIVACY: the text the operator asks to read never appears in an error
 * message or a log line. Errors carry the status and, for a guard block, the
 * rule id only.
 */

/** Mirrors the backend cap (`_CHAT_TEXT_MAX_LENGTH`). */
export const SPEECH_TEXT_MAX_LENGTH = 4000;

export type SpeechSayMode = "queue" | "now";

export interface SpeechSayResponse {
  job_id: number;
}

export interface SpeechStopResponse {
  discarded: number;
}

export interface SpeechPauseResponse {
  paused: boolean;
}

export interface SpeechState {
  paused: boolean;
  readaloud_active: boolean;
  readaloud_pending: number;
}

/** 422 `{detail: {error: "GUARD_BLOCKED", rule}}`: the output guard refused the text. */
export class GuardBlockedError extends ApiError {
  readonly rule: string;
  constructor(rule: string) {
    super("speech text blocked by guard", 422);
    this.name = "GuardBlockedError";
    this.rule = rule;
  }
}

/** 503: the speech router is not armed (or not running). */
export class SpeechUnavailableError extends ApiError {
  constructor() {
    super("speech unavailable", 503);
    this.name = "SpeechUnavailableError";
  }
}

async function readJson(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

async function postSpeech<T>(path: string, body?: unknown): Promise<T> {
  const res = await authFetch(`${getApiBaseUrl()}${path}`, {
    method: "POST",
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  if (res.status === 503) {
    throw new SpeechUnavailableError();
  }
  if (res.status === 422) {
    const parsed = (await readJson(res)) as { detail?: unknown } | null;
    const detail = parsed?.detail;
    if (detail && typeof detail === "object" && (detail as { error?: unknown }).error === "GUARD_BLOCKED") {
      const rule = (detail as { rule?: unknown }).rule;
      throw new GuardBlockedError(typeof rule === "string" ? rule : "unknown");
    }
    throw new ValidationError(typeof detail === "string" ? detail : "invalid speech request");
  }
  if (!res.ok) {
    throw new ApiError(`POST ${path} failed with ${res.status}`, res.status);
  }
  return (await res.json()) as T;
}

export function postSpeechSay(text: string, mode: SpeechSayMode = "queue"): Promise<SpeechSayResponse> {
  return postSpeech<SpeechSayResponse>("/api/speech/say", { text, mode });
}

export function postSpeechStop(): Promise<SpeechStopResponse> {
  return postSpeech<SpeechStopResponse>("/api/speech/stop");
}

export function postSpeechPause(): Promise<SpeechPauseResponse> {
  return postSpeech<SpeechPauseResponse>("/api/speech/pause");
}

export function postSpeechResume(): Promise<SpeechPauseResponse> {
  return postSpeech<SpeechPauseResponse>("/api/speech/resume");
}

export async function getSpeechState(): Promise<SpeechState> {
  const res = await authFetch(`${getApiBaseUrl()}/api/speech/state`);
  if (!res.ok) {
    throw new ApiError(`GET /api/speech/state failed with ${res.status}`, res.status);
  }
  return (await res.json()) as SpeechState;
}

export const SPEECH_STATE_QUERY_KEY = ["speech", "state"] as const;

const POLL_ACTIVE_MS = 1000;
const POLL_IDLE_MS = 4000;

/** Polls GET /api/speech/state: ~1s while read-aloud is active/pending/paused, slower when idle.
 * Stops with the component that mounts it. */
export function useSpeechState() {
  return useQuery({
    queryKey: SPEECH_STATE_QUERY_KEY,
    queryFn: getSpeechState,
    refetchInterval: (query) => {
      const s = query.state.data;
      return s && (s.paused || s.readaloud_active || s.readaloud_pending > 0) ? POLL_ACTIVE_MS : POLL_IDLE_MS;
    },
    refetchIntervalInBackground: true
  });
}

export type SpeechErrorKind = "guard" | "unavailable" | "invalid" | "generic";

export function classifySpeechError(error: unknown): SpeechErrorKind {
  if (error instanceof GuardBlockedError) return "guard";
  if (error instanceof SpeechUnavailableError) return "unavailable";
  if (error instanceof ValidationError) return "invalid";
  return "generic";
}

/** Read-aloud actions plus the last error kind (never the message, never the text). */
export function useReadAloud() {
  const queryClient = useQueryClient();
  const [errorKind, setErrorKind] = useState<SpeechErrorKind | null>(null);

  const mutation = useMutation({
    mutationFn: (op: () => Promise<unknown>) => op(),
    onMutate: () => setErrorKind(null),
    onError: (error) => setErrorKind(classifySpeechError(error)),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: SPEECH_STATE_QUERY_KEY });
    }
  });
  const run = mutation.mutate;

  return {
    say: useCallback((text: string, mode: SpeechSayMode = "queue") => run(() => postSpeechSay(text, mode)), [run]),
    stop: useCallback(() => run(() => postSpeechStop()), [run]),
    pause: useCallback(() => run(() => postSpeechPause()), [run]),
    resume: useCallback(() => run(() => postSpeechResume()), [run]),
    busy: mutation.isPending,
    errorKind,
    clearError: useCallback(() => setErrorKind(null), [])
  };
}
