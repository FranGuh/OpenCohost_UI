import { useEffect, useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError, authFetch, getApiBaseUrl } from "./client.js";
import type { components } from "./types.gen.js";

/**
 * Operator side of phone pairing (opencohost/api/routers/remote.py). Every call
 * needs the operator token, GET included, so ALL of them go through authFetch.
 * A 409 `{error: "gateway_disabled"}` is a normal state (the remote gateway is
 * off), surfaced as a typed error rather than a failure.
 *
 * Never log a pairing code: it is the key to the house.
 */

export type RemotePairCode = components["schemas"]["RemotePairCodeResponse"];
export type RemoteDevice = components["schemas"]["RemoteDevice"];
export type RemoteDevicesResponse = components["schemas"]["RemoteDevicesResponse"];
export type RemoteRevokeResponse = components["schemas"]["RemoteRevokeResponse"];

/** One accepted phone message (opencohost/gateway/feed.py). Hand-written until
 * `types.gen.ts` is regenerated against the new route. */
export interface RemoteMessage {
  seq: number;
  text: string;
  accepted_at: number;
  device_id: string;
  device_label: string;
}
export interface RemoteMessagesResponse {
  items: RemoteMessage[];
  latest_seq: number;
}

export class RemoteGatewayDisabledError extends ApiError {
  constructor() {
    super("remote gateway is disabled", 409);
    this.name = "RemoteGatewayDisabledError";
  }
}

export function isGatewayDisabled(error: unknown): boolean {
  return error instanceof RemoteGatewayDisabledError;
}

async function call<T>(method: string, path: string): Promise<T> {
  const res = await authFetch(`${getApiBaseUrl()}${path}`, { method });
  if (res.status === 409) {
    throw new RemoteGatewayDisabledError();
  }
  if (!res.ok) {
    throw new ApiError(`${method} ${path} failed with ${res.status}`, res.status);
  }
  return (await res.json()) as T;
}

export function postPairCode(): Promise<RemotePairCode> {
  return call<RemotePairCode>("POST", "/api/remote/pair-code");
}

export function getRemoteDevices(): Promise<RemoteDevicesResponse> {
  return call<RemoteDevicesResponse>("GET", "/api/remote/devices");
}

export function deleteRemoteDevice(deviceId: string): Promise<RemoteRevokeResponse> {
  return call<RemoteRevokeResponse>("DELETE", `/api/remote/devices/${encodeURIComponent(deviceId)}`);
}

export const REMOTE_DEVICES_QUERY_KEY = ["remote", "devices"] as const;

export function useRemoteDevicesQuery() {
  // A disabled gateway will not enable itself on retry (needs a restart).
  return useQuery({ queryKey: REMOTE_DEVICES_QUERY_KEY, queryFn: getRemoteDevices, retry: false });
}

export function usePairCodeMutation() {
  return useMutation({ mutationFn: postPairCode });
}

export function useRevokeDeviceMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: deleteRemoteDevice,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: REMOTE_DEVICES_QUERY_KEY })
  });
}

export function getRemoteMessages(after: number): Promise<RemoteMessagesResponse> {
  return call<RemoteMessagesResponse>("GET", `/api/remote/messages?after=${encodeURIComponent(String(after))}`);
}

export const REMOTE_MESSAGES_POLL_MS = 1000;
const REMOTE_MESSAGES_ERROR_POLL_MS = 5000;

/**
 * Polls the operator-only phone-message feed and hands each NEW message to
 * `onMessages` exactly once, oldest first. The first successful poll only sets
 * the cursor (what was already in the feed at mount is never replayed, so a
 * remount does not duplicate old bubbles). Deliberately not a react-query
 * query: the cache would hand old items to a fresh mount. Pauses while the
 * window is hidden (the cursor catches up on return) and stops for good when
 * the gateway is disabled. The text is only ever passed to the callback.
 */
export function useRemoteMessages(
  onMessages: (items: RemoteMessage[]) => void,
  intervalMs: number = REMOTE_MESSAGES_POLL_MS
): void {
  const callbackRef = useRef(onMessages);
  callbackRef.current = onMessages;

  useEffect(() => {
    let cancelled = false;
    let cursor: number | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const schedule = (ms: number) => {
      if (!cancelled) timer = setTimeout(() => void tick(), ms);
    };
    const tick = async () => {
      if (typeof document !== "undefined" && document.hidden) {
        schedule(intervalMs);
        return;
      }
      try {
        const body = await getRemoteMessages(cursor ?? 0);
        if (cancelled) return;
        const items = cursor === null ? [] : body.items.filter((m) => m.seq > cursor!);
        cursor = Math.max(cursor ?? 0, body.latest_seq);
        if (items.length > 0) callbackRef.current(items);
        schedule(intervalMs);
      } catch (error) {
        if (cancelled || isGatewayDisabled(error)) return;
        schedule(Math.max(intervalMs, REMOTE_MESSAGES_ERROR_POLL_MS));
      }
    };

    void tick();
    return () => {
      cancelled = true;
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [intervalMs]);
}
