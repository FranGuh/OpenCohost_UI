import { ApiError, authFetch, getApiBaseUrl } from "./client.js";

/**
 * Update check (opencohost/api/routers/update.py, update-notification-20261111).
 * Notify-and-link only: the backend asks GitHub once per launch and caches the
 * answer. Hand-typed, newer than the OpenAPI snapshot (same pattern as
 * src/api/replyLength.ts). Errors surface as a plain ApiError with the status.
 */
export interface UpdateStatus {
  enabled: boolean;
  current: string;
  latest: string | null;
  newer: boolean;
  url: string | null;
}

export async function getUpdateStatus(): Promise<UpdateStatus> {
  const res = await authFetch(`${getApiBaseUrl()}/api/update`);
  if (!res.ok) throw new ApiError(`GET /api/update failed with ${res.status}`, res.status);
  return (await res.json()) as UpdateStatus;
}

export async function putUpdateConfig(enabled: boolean): Promise<{ enabled: boolean }> {
  const res = await authFetch(`${getApiBaseUrl()}/api/update/config`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ enabled })
  });
  if (!res.ok) throw new ApiError(`PUT /api/update/config failed with ${res.status}`, res.status);
  return (await res.json()) as { enabled: boolean };
}
