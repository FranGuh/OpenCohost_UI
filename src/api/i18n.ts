import { ApiError, ValidationError, authFetch, getApiBaseUrl } from "./client.js";

/**
 * GET/PUT /api/i18n (opencohost/api/main.py, kira_bilingual_e2e_20260705 P7)
 * has no generated type yet — hand-typed from opencohost/api/models.py::
 * I18nStateResponse/I18nBundleInfo/I18nWarning. D6: locale switching is
 * next-boot only — this endpoint never hot-swaps the running backend
 * process; `pending_restart` is the honest "applies on next start" signal.
 * ponytail: keep in sync manually.
 */
export interface I18nBundleInfo {
  code: string;
  display: string;
  tier: string;
  status: string;
}

export interface I18nWarning {
  code: string;
  message: string;
}

export interface I18nStateResponse {
  active_locale: string;
  persisted_locale: string;
  pending_restart: boolean;
  available: I18nBundleInfo[];
  warnings: I18nWarning[];
}

async function extractDetail(res: Response, fallback: string): Promise<string> {
  try {
    const body = (await res.json()) as { detail?: string };
    return body.detail ?? fallback;
  } catch {
    // non-JSON error body — fall back to a generic message instead of
    // letting res.json() throw an opaque SyntaxError.
    return fallback;
  }
}

export async function getI18nState(): Promise<I18nStateResponse> {
  const res = await fetch(`${getApiBaseUrl()}/api/i18n`);
  if (!res.ok) {
    throw new ApiError(`GET /api/i18n failed with ${res.status}`, res.status);
  }
  return (await res.json()) as I18nStateResponse;
}

/**
 * PUT /api/i18n — sets the PERSISTED locale only (D6: applies on next start,
 * never a hot-swap of the running process). 422 when `locale` matches no
 * discovered bundle (BCP-47 normalized server-side).
 */
export async function putI18nLocale(locale: string): Promise<I18nStateResponse> {
  const res = await authFetch(`${getApiBaseUrl()}/api/i18n`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ locale })
  });
  if (res.status === 422) {
    throw new ValidationError(await extractDetail(res, "unknown locale"));
  }
  if (!res.ok) {
    throw new ApiError(`PUT /api/i18n failed with ${res.status}`, res.status);
  }
  return (await res.json()) as I18nStateResponse;
}
