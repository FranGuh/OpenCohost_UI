import type { components } from "./types.gen.js";
import { ApiError, authFetch, getApiBaseUrl } from "./client.js";

export type TavilyKeyResponse = components["schemas"]["TavilyKeyResponse"];
const path = "/api/web-fetch/tavily";

async function readStatus(response: Response): Promise<TavilyKeyResponse> {
  if (!response.ok) throw new ApiError("tavily_setting_failed", response.status);
  const data = (await response.json()) as TavilyKeyResponse;
  if (typeof data?.api_key_set !== "boolean" || typeof data.stored_key_set !== "boolean" ||
      typeof data.storage_available !== "boolean" ||
      !["none", "keyring", "environment", "environment_disabled"].includes(data.source)) {
    throw new ApiError("tavily_setting_failed", 502);
  }
  // Allowlist the four status fields: even an unexpected backend response
  // must never rehydrate a credential into query state.
  return { api_key_set: data.api_key_set, stored_key_set: data.stored_key_set,
    source: data.source, storage_available: data.storage_available };
}

export async function getTavilySettings(): Promise<TavilyKeyResponse> {
  try {
    return await readStatus(await authFetch(`${getApiBaseUrl()}${path}`));
  } catch (error) {
    throw new ApiError("tavily_setting_failed", error instanceof ApiError ? error.status : 0);
  }
}

export async function putTavilySettings(body: { api_key: string }): Promise<TavilyKeyResponse> {
  const init: RequestInit = { method: "PUT", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ api_key: body.api_key }) };
  try {
    return await readStatus(await authFetch(`${getApiBaseUrl()}${path}`, init));
  } catch (error) {
    // Never surface a transport/backend error message that may echo the body.
    throw new ApiError("tavily_setting_failed", error instanceof ApiError ? error.status : 0);
  } finally {
    body.api_key = "";
    init.body = undefined;
  }
}
