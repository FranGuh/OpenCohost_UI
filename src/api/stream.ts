import { useEffect, useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ApiError,
  ConflictError,
  ValidationError,
  authFetch,
  bootstrapApiToken,
  getApiBaseUrl,
  getAuthHeaders
} from "./client.js";
import { useStreamChatStore } from "../store/streamChatStore.js";

/**
 * GET /api/stream/chat-live + POST .../connect + POST .../disconnect + PUT
 * .../limits (opencohost/api/main.py ~549-624) predate types.gen.ts's
 * OpenAPI generation, so they have no generated type — hand-typed from
 * opencohost/api/models.py::StreamChatLiveResponse/StreamConnectRequest/
 * StreamLimitsRequest. R8-CRITICAL: these four stay STATE + LIMITS ONLY —
 * never add a viewer-message-text field to any of them.
 *
 * `GET /api/stream/chat-live/messages` (RF3, tauri_stream_chat_20260812 B3)
 * is the ONE deliberate, owner-approved exception to that rule — it carries
 * real viewer author/text down to the operator's own local UI (Stream tab of
 * ConversationPanel), on purpose. It's safe to do because: (1) it's gated on
 * the operator bearer token — 403 `operator_token_required` without one,
 * self-enforced server-side regardless of API_AUTH_ENFORCED (see
 * opencohost/api/routers/stream.py::_operator_role); (2) the backend only
 * ever listens on loopback, so this never leaves the machine; (3) every
 * message it can return already passed MessageFilter, the spam gate, AND
 * `runtime_screen` (opencohost/api/engine_host.py::ChatFeedSink docstring) —
 * it is by construction the same subset of chat Kira herself is allowed to
 * see; (4) that screened text reaching the LLM at all is a SEPARATE control,
 * `wrap_untrusted_chat` on the backend, unaffected by this endpoint existing.
 * None of this changes what the state/limits endpoints above expose, and
 * none of it is a claim this file can't back with the backend source above.
 * ponytail: keep in sync manually if those models change.
 */
export interface StreamChatLiveResponse {
  connected: boolean;
  platform: string | null;
  source_id: string | null;
  threshold_per_second: number;
  cooldown_seconds: number;
  max_messages_per_user: number;
  filter_policy: string;
  /** The `USE_INPUT_CONTRACT_PROMPT` module flag
   * (opencohost/smart_aggregator/chat_input_contract.py) — NOT related to
   * `filter_policy` above (a separate 3-way preset). See StreamPanel.tsx's
   * AccionesCard for what this actually does operator-side. */
  input_contract: boolean;
}

export interface StreamLimitsRequest {
  threshold_per_second?: number;
  cooldown_seconds?: number;
  max_messages_per_user?: number;
  filter_policy?: string;
  input_contract?: boolean;
}

export const STREAM_CHAT_LIVE_QUERY_KEY = ["stream-chat-live"] as const;

export async function getStreamChatLive(): Promise<StreamChatLiveResponse> {
  const res = await fetch(`${getApiBaseUrl()}/api/stream/chat-live`);
  if (!res.ok) {
    throw new ApiError(`GET /api/stream/chat-live failed with ${res.status}`, res.status);
  }
  return (await res.json()) as StreamChatLiveResponse;
}

export async function postStreamConnect(url: string): Promise<StreamChatLiveResponse> {
  const res = await authFetch(`${getApiBaseUrl()}/api/stream/chat-live/connect`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url })
  });

  if (res.status === 409) {
    throw new ConflictError("stream connect busy");
  }
  if (res.status === 422) {
    // Lote C: backend now sends `invalid_url` (bad URL shape) OR
    // `unsupported_platform` (aggregator rejected the platform). Both are
    // ValidationErrors; errorCopy maps the KNOWN codes to voseo copy.
    let detail = "invalid_url";
    try {
      const body = (await res.json()) as { detail?: string };
      detail = body.detail ?? detail;
    } catch {
      // non-JSON 422 body — fall back to a generic message.
    }
    throw new ValidationError(detail);
  }
  if (res.status === 503) {
    // Lote C: `chat_source_unavailable` (connector not installed) vs
    // `stream_unavailable` (no aggregator / unexpected failure). Carry the
    // CODE as the ApiError message so errorCopy can name the right cause —
    // never a raw traceback (R8/F4).
    let detail = "stream_unavailable";
    try {
      const body = (await res.json()) as { detail?: string };
      detail = body.detail ?? detail;
    } catch {
      // non-JSON 503 body — fall back to the generic code.
    }
    throw new ApiError(detail, 503);
  }
  if (!res.ok) {
    throw new ApiError(`POST /api/stream/chat-live/connect failed with ${res.status}`, res.status);
  }
  return (await res.json()) as StreamChatLiveResponse;
}

/**
 * Thrown by `connectStreamAndAwait` when the connect POST succeeded but the
 * chat never reported `connected:true` within the poll budget — i.e. the
 * directo probably is not actually live. Distinct type so `errorCopy` can
 * produce the "verificá que esté EN VIVO" copy instead of a generic retry.
 */
export class StreamConnectTimeoutError extends Error {
  constructor(message = "stream_connect_timeout") {
    super(message);
    this.name = "StreamConnectTimeoutError";
  }
}

export interface StreamConnectPollOptions {
  /** Status polls AFTER the initial POST (default 7 ≈ 5.6s @ 800ms). */
  attempts?: number;
  /** Delay between polls in ms (default 800). */
  intervalMs?: number;
  /** Injected sleep — tests pass a no-op to run instantly. */
  sleep?: (ms: number) => Promise<void>;
  /** Injected status reader — tests stub this. */
  getStatus?: () => Promise<StreamChatLiveResponse>;
}

/**
 * Lote C — honest connect: POST connect, then poll GET /api/stream/chat-live
 * until `connected:true` or the budget runs out. The backend launches the real
 * connection on a daemon thread, so the POST almost always returns
 * `connected:false` a beat before the socket is up; polling is what makes the
 * /vivo ack honest instead of the near-guaranteed false negative the raw POST
 * response gave. Connect errors (422/409/503) propagate unchanged; budget
 * exhaustion throws `StreamConnectTimeoutError`.
 */
export async function connectStreamAndAwait(
  url: string,
  opts: StreamConnectPollOptions = {}
): Promise<StreamChatLiveResponse> {
  const attempts = opts.attempts ?? 7;
  const intervalMs = opts.intervalMs ?? 800;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const getStatus = opts.getStatus ?? getStreamChatLive;

  const initial = await postStreamConnect(url);
  if (initial.connected) return initial;

  for (let i = 0; i < attempts; i++) {
    await sleep(intervalMs);
    const status = await getStatus();
    if (status.connected) return status;
  }
  throw new StreamConnectTimeoutError();
}

export async function postStreamDisconnect(): Promise<StreamChatLiveResponse> {
  const res = await authFetch(`${getApiBaseUrl()}/api/stream/chat-live/disconnect`, { method: "POST" });

  if (res.status === 409) {
    throw new ConflictError("stream disconnect busy");
  }
  if (!res.ok) {
    throw new ApiError(`POST /api/stream/chat-live/disconnect failed with ${res.status}`, res.status);
  }
  return (await res.json()) as StreamChatLiveResponse;
}

export async function putStreamLimits(body: StreamLimitsRequest): Promise<StreamChatLiveResponse> {
  const res = await authFetch(`${getApiBaseUrl()}/api/stream/chat-live/limits`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });

  if (res.status === 422) {
    let detail = "invalid_filter_policy";
    try {
      const errBody = (await res.json()) as { detail?: string };
      detail = errBody.detail ?? detail;
    } catch {
      // non-JSON 422 body — fall back to a generic message.
    }
    throw new ValidationError(detail);
  }
  if (!res.ok) {
    throw new ApiError(`PUT /api/stream/chat-live/limits failed with ${res.status}`, res.status);
  }
  return (await res.json()) as StreamChatLiveResponse;
}

/**
 * Connection state is polled, not cached-once. Nothing else refreshes it: the
 * connect/disconnect mutations below write their OWN response into the cache,
 * and the connect POST answers `connected:false` because the backend brings
 * the socket up on a daemon thread (see connectStreamAndAwait) — while
 * `connectStreamAndAwait` itself (the /vivo path) never touches the cache at
 * all. Without an interval the header sat on that first false answer for the
 * rest of the session and reported "desconectado" over a live feed.
 *
 * 5s, not the 1.5s house cadence: this is a connection flag, not chat.
 */
export function useStreamChatLiveQuery() {
  return useQuery({
    queryKey: STREAM_CHAT_LIVE_QUERY_KEY,
    queryFn: getStreamChatLive,
    refetchInterval: 5000
  });
}

export function useStreamConnectMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: postStreamConnect,
    meta: { event: { source: "stream", action: "connect" } }, // NO url — may embed channel identifiers
    onSuccess: (data) => {
      queryClient.setQueryData(STREAM_CHAT_LIVE_QUERY_KEY, data);
    }
  });
}

export function useStreamDisconnectMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: postStreamDisconnect,
    meta: { event: { source: "stream", action: "disconnect", tone: "neutral" } },
    onSuccess: (data) => {
      queryClient.setQueryData(STREAM_CHAT_LIVE_QUERY_KEY, data);
    }
  });
}

export function useStreamLimitsMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: putStreamLimits,
    meta: { event: { source: "stream", action: "limits" } },
    onSuccess: (data) => {
      queryClient.setQueryData(STREAM_CHAT_LIVE_QUERY_KEY, data);
    }
  });
}

/**
 * GET /api/stream/chat-live/messages?since=cursor (RF3) — one entry per
 * already-screened viewer chat line. Hand-typed from
 * opencohost/api/models.py::ChatLiveMessageOut/ChatLiveMessagesResponse (no
 * generated type, same snapshot-lag reason as StreamChatLiveResponse above).
 * `ts` is Python `time.time()` (seconds) — callers multiply by 1000 for a JS
 * Date, same convention as LastReplyResponse.ts and ServerEvent.ts elsewhere.
 * `more_pending` mirrors the backend's own page cap (50/poll, see
 * routers/stream.py) — true when the sink held more than that; `cursor`
 * already advances only to the last message actually returned in that case,
 * so a plain polling loop drains the backlog over consecutive polls without
 * needing to read this field itself.
 */
export interface StreamChatMessage {
  seq: number;
  author: string;
  text: string;
  ts: number;
}

export interface StreamChatMessagesResponse {
  messages: StreamChatMessage[];
  cursor: number;
  boot: number;
  /** Starts at 0, increments on every successful connect (including a
   * reconnect to the SAME channel) — the server clears its own buffer at
   * that moment. Unlike `boot`, `seq` stays monotonic across a session
   * change, so this is the only client-visible signal that a channel switch
   * happened (see streamChatStore.ts's ingest). */
  session: number;
  more_pending: boolean;
}

/**
 * `authFetch`, not bare `fetch` — deliberate exception to this file's own
 * "GET = fetch" convention (see getStreamChatLive above): this GET is
 * token-gated (403 without an operator bearer token), so it needs the same
 * Authorization header the mutating calls below already attach. Do not "fix"
 * this back to `fetch`.
 */
export async function getStreamChatMessages(since: number): Promise<StreamChatMessagesResponse> {
  const url = `${getApiBaseUrl()}/api/stream/chat-live/messages?since=${since}`;
  let res = await authFetch(url);
  if (res.status === 403) {
    // `authFetch` re-mints the cached token on a 401 only, but THIS endpoint
    // answers 403 for a missing/stale operator token — including the startup
    // race its own docstring documents ("token file appears AFTER Tauri
    // probes"). Without this the panel stayed pinned in the forbidden state
    // until the whole app restarted. Re-bootstrap once and retry once; a
    // second 403 is the real answer. Same shape as authFetch's own retry
    // (only retry when a token actually exists to retry WITH), so plain
    // browser dev — where no token can ever be minted — never doubles the
    // request. No loop.
    await bootstrapApiToken();
    if (getAuthHeaders().Authorization) res = await authFetch(url);
  }
  if (res.status === 403) {
    // No operator token reached the backend — distinguishable via
    // ApiError.status so the panel can render its own "can't read chat from
    // here" state instead of a generic failure.
    throw new ApiError("operator token required", 403);
  }
  if (!res.ok) {
    throw new ApiError(`GET /api/stream/chat-live/messages failed with ${res.status}`, res.status);
  }
  return (await res.json()) as StreamChatMessagesResponse;
}

export const STREAM_CHAT_MESSAGES_QUERY_KEY = ["stream-chat-live-messages"] as const;

/**
 * Polls GET /api/stream/chat-live/messages at the house cadence (mirrors
 * src/api/events.ts::useServerEventLog / src/api/chat.ts) and feeds every
 * response straight into useStreamChatStore.ingest(), which owns the
 * dedup/cap/boot-reset contract (see streamChatStore.ts) — this hook only
 * owns the cursor ref and the poll itself. `refetchIntervalInBackground`
 * matters here specifically: StreamChatPanel keeps polling while its tab is
 * hidden (Tabs keeps inactive panels mounted, src/ui/Tabs.tsx) so the unread
 * dot can light up and a long stretch off-tab doesn't fall behind the
 * server's 200-deep buffer.
 */
export function useStreamChatMessages() {
  const lastCursor = useRef(0);
  const query = useQuery({
    queryKey: STREAM_CHAT_MESSAGES_QUERY_KEY,
    queryFn: () => getStreamChatMessages(lastCursor.current),
    refetchInterval: 1500,
    refetchIntervalInBackground: true
  });

  useEffect(() => {
    if (!query.data) return;
    // Read boot/session BEFORE ingest — ingest overwrites them with the
    // response's own values.
    const previous = useStreamChatStore.getState();
    const restarted =
      (previous.boot !== null && previous.boot !== query.data.boot) ||
      (previous.session !== null && previous.session !== query.data.session);
    useStreamChatStore.getState().ingest(query.data);
    // A boot/session change means the server rebuilt its own buffer and (on a
    // boot change) restarted `seq` at 1. Carrying the old high cursor into the
    // next poll is silent data loss: the server filters `seq > since` BEFORE
    // this client can observe the new boot, so everything the new process
    // buffered up to now would never be delivered. EventLogResponse documents
    // the same rule server-side ("reset `since` to 0 when `boot` changes").
    // The store dedups by seq, so re-ingesting the overlap is harmless.
    lastCursor.current = restarted ? 0 : query.data.cursor;
  }, [query.data]);

  return query;
}
