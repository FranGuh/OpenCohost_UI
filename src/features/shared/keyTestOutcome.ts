import type { TKey } from "../../i18n/t.js";
import { ApiError } from "../../api/client.js";
import type { LlmProviderTestErrorCode, LlmProviderTestResponse } from "../../api/llmProvider.js";

export type KeyTestOutcome = {
  /** pass: key + model OK; keyOnly: key OK, chat stage did not run; chatFail / keyFail: a stage failed. */
  kind: "pass" | "keyOnly" | "chatFail" | "keyFail";
  line: string;
  /** Small "HTTP <status>[: <message>]" line, or null when there is no status. */
  detail: string | null;
};

type Translate = (key: TKey, vars?: Record<string, string | number>) => string;

const CHAT_KEYS: Record<string, TKey> = {
  cloud_auth: "keytest.chat.cloud_auth",
  cloud_rate_limit: "keytest.chat.cloud_rate_limit",
  cloud_bad_request: "keytest.chat.cloud_bad_request",
  timeout: "keytest.chat.timeout",
  cloud_error: "keytest.chat.cloud_error"
};

function detailLine(result: LlmProviderTestResponse, t: Translate): string | null {
  const status = result.http_status;
  const message = (result.provider_message ?? "").trim();
  if (typeof status === "number") {
    return message ? t("keytest.detail", { status, message }) : t("keytest.detailBare", { status });
  }
  return message || null;
}

function isTimeoutError(error: unknown): boolean {
  if (error instanceof DOMException && (error.name === "TimeoutError" || error.name === "AbortError")) {
    return true;
  }
  return error instanceof Error && /timed?\s*out/i.test(error.message);
}

/** Converts a failed /api/llm/provider/test request error into a structured outcome with HTTP status or timeout detail. */
export function testErrorToResponse(error: unknown, t: Translate): LlmProviderTestResponse {
  const timeout = isTimeoutError(error);
  if (error instanceof ApiError) {
    const httpStatus = error.status > 0 ? error.status : null;
    const errorCode: LlmProviderTestErrorCode =
      httpStatus === 401 || httpStatus === 403
        ? "invalid_key"
        : httpStatus === 429
          ? "rate_limited"
          : "unreachable";
    return {
      ok: false,
      error_code: errorCode,
      http_status: httpStatus,
      provider_message: error.message.trim() || (timeout ? t("keytest.error.timeout") : null),
      models: [],
      recommended: []
    };
  }
  if (timeout) {
    return {
      ok: false,
      error_code: "unreachable",
      http_status: null,
      provider_message: t("keytest.error.timeout"),
      models: [],
      recommended: []
    };
  }
  return {
    ok: false,
    error_code: "unreachable",
    http_status: null,
    provider_message: error instanceof Error && error.message.trim() ? error.message.trim() : null,
    models: [],
    recommended: []
  };
}

/** Plain-language result of the two-stage provider test (key, then one tiny chat). */
export function keyTestOutcome(result: LlmProviderTestResponse, t: Translate): KeyTestOutcome {
  if (!result.ok) {
    const code = result.error_code ?? "unexpected";
    return {
      kind: "keyFail",
      line: t(`controles.provider.editor.test.error.${code}` as "controles.provider.editor.test.error.unexpected"),
      detail: detailLine(result, t)
    };
  }
  if (result.chat_ok === true) {
    return { kind: "pass", line: t("keytest.ok"), detail: null };
  }
  if (result.chat_ok === false) {
    const key = CHAT_KEYS[result.chat_error_code ?? "cloud_error"] ?? CHAT_KEYS.cloud_error;
    return { kind: "chatFail", line: t(key), detail: detailLine(result, t) };
  }
  return {
    kind: "keyOnly",
    line: t("controles.provider.editor.test.ok", { count: result.models.length }),
    detail: null
  };
}
