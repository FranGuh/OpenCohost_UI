import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError, NotFoundError, authFetch, getApiBaseUrl } from "./client.js";
import type { components } from "./types.gen.js";

/** GET /api/usage/summary and friends (usage activity ledger). The data is
 * content-free: numbers, fixed enum labels, model names and profile ids. */
export type UsageSummary = components["schemas"]["UsageSummaryResponse"];
export type UsagePurgeResponse = components["schemas"]["UsagePurgeResponse"];
export type UsageExportFormat = "json" | "csv";

/** The backend requires this exact literal to purge (422 `confirm_required` otherwise). */
const PURGE_CONFIRMATION = "DELETE_USAGE";

export const usageSummaryQueryKey = ["usage-summary"] as const;

export async function getUsageSummary(): Promise<UsageSummary> {
  const res = await authFetch(`${getApiBaseUrl()}/api/usage/summary`);
  // A 404 means an older engine without the ledger: callers show "not available".
  if (res.status === 404) throw new NotFoundError("GET /api/usage/summary is not available");
  if (!res.ok) throw new ApiError(`GET /api/usage/summary failed with ${res.status}`, res.status);
  return (await res.json()) as UsageSummary;
}

/** Fetches the export with the operator token; the caller saves the Blob. */
export async function downloadUsageExport(format: UsageExportFormat): Promise<Blob> {
  const res = await authFetch(`${getApiBaseUrl()}/api/usage/export?format=${format}`);
  if (!res.ok) throw new ApiError(`GET /api/usage/export failed with ${res.status}`, res.status);
  return await res.blob();
}

export async function postUsagePurge(): Promise<UsagePurgeResponse> {
  const res = await authFetch(`${getApiBaseUrl()}/api/usage/purge`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ confirm: PURGE_CONFIRMATION })
  });
  if (!res.ok) throw new ApiError(`POST /api/usage/purge failed with ${res.status}`, res.status);
  return (await res.json()) as UsagePurgeResponse;
}

export function useUsageSummaryQuery(enabled = true) {
  return useQuery({
    queryKey: usageSummaryQueryKey,
    queryFn: getUsageSummary,
    enabled,
    // An old engine will keep answering 404; do not hammer it.
    retry: (count, error) => !(error instanceof NotFoundError) && count < 1,
    retryDelay: 300
  });
}

export function useUsagePurgeMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: postUsagePurge,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: usageSummaryQueryKey })
  });
}
