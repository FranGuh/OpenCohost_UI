import { Gauge, Loader2 } from "lucide-react";
import { formatMetric, useInferenceTest, type InferenceErrorCode, type InferenceTestResponse } from "../../api/setup.js";
import { Alert, type AlertTone } from "../../ui/Alert.js";
import { Button } from "../../ui/Button.js";
import { useT, type TKey } from "../../i18n/t.js";
import type { StepProps } from "./SetupSteps.js";

const VERDICT: Record<InferenceTestResponse["status"], { key: TKey; tone: AlertTone }> = {
  passed: { key: "setup.test.verdict.passed", tone: "ok" },
  slow: { key: "setup.test.verdict.slow", tone: "warn" },
  failed: { key: "setup.test.verdict.failed", tone: "danger" }
};

const ERROR_COPY: Record<InferenceErrorCode, TKey> = {
  ollama_unreachable: "setup.test.error.ollama_unreachable",
  model_missing: "setup.test.error.model_missing",
  timeout: "setup.test.error.timeout",
  cloud_auth: "setup.test.error.cloud_auth",
  cloud_rate_limit: "setup.test.error.cloud_rate_limit",
  cloud_bad_request: "setup.test.error.cloud_bad_request",
  cloud_error: "setup.test.error.cloud_error",
  busy: "setup.test.error.busy"
};

/**
 * Runs POST /api/setup/inference-test (fixed prompt, no user content) and shows
 * the median warm metrics. Any outcome — including a request failure — counts
 * as "tested", so a broken engine never traps the user in the assistant.
 */
export interface InferenceTestStepProps extends StepProps {
  /** The local model the user chose; the result is checked against it. Null on the cloud path. */
  expectedModel: { tag: string; name: string } | null;
}

export function InferenceTestStep({ dispatch, expectedModel }: InferenceTestStepProps) {
  const t = useT();
  const test = useInferenceTest();
  const result = test.data;

  function handleRun() {
    test.mutate(3, {
      // The metrics ride into the machine so Kira can read the verdict back (fixed line, no LLM).
      onSuccess: (data) =>
        dispatch({
          type: "testFinished",
          verdict: data.status,
          firstTokenMs: data.metrics.first_token_ms,
          tokensPerSecond: data.metrics.tokens_per_second,
          errorCode: data.error_code
        }),
      onError: () => dispatch({ type: "testFinished", verdict: "failed" })
    });
  }

  const mismatch = Boolean(result?.model && expectedModel && result.provider === "local" && result.model !== expectedModel.tag);

  const metrics = result
    ? [
        { label: "setup.test.metric.load" as const, hint: "setup.test.metric.load.hint" as const, value: formatMetric(result.metrics.load_ms, "ms") },
        { label: "setup.test.metric.first" as const, hint: "setup.test.metric.first.hint" as const, value: formatMetric(result.metrics.first_token_ms, "ms") },
        { label: "setup.test.metric.tps" as const, hint: "setup.test.metric.tps.hint" as const, value: formatMetric(result.metrics.tokens_per_second, "tps") }
      ]
    : [];

  return (
    <div className="flex flex-col gap-4">
      <p className="max-w-xl text-sm leading-relaxed text-muted-foreground">{t("setup.test.copy")}</p>
      <Button type="button" variant="primary" disabled={test.isPending} onClick={handleRun} className="h-11 self-start px-5">
        {test.isPending ? (
          <Loader2 size={15} className="animate-spin motion-reduce:animate-none" aria-hidden="true" />
        ) : (
          <Gauge size={15} aria-hidden="true" />
        )}
        {test.isPending ? t("setup.test.running") : result || test.isError ? t("setup.test.again") : t("setup.test.run")}
      </Button>

      <div aria-live="polite" className="flex flex-col gap-3">
        {test.isPending && (
          <p role="status" className="inline-flex items-center gap-2 text-sm text-info">
            <Loader2 size={14} className="shrink-0 animate-spin motion-reduce:animate-none" aria-hidden="true" />
            <span>{t("setup.test.running")}</span>
          </p>
        )}
        {result && (
          <>
            {result.model && <p className="mono text-xs text-dim">{t("setup.test.model", { model: result.model })}</p>}
            {mismatch && result.model && expectedModel && (
              <Alert tone="warn" role="status">
                {t("setup.test.mismatch", { actual: result.model, chosen: expectedModel.name })}
              </Alert>
            )}
            <dl className="grid gap-2 sm:grid-cols-3">
              {metrics.map((metric) => (
                <div key={metric.label} className="rounded-md border border-border-soft bg-surface-2 px-3.5 py-3">
                  <dt className="text-[11px] font-semibold uppercase tracking-[0.09em] text-dim">{t(metric.label)}</dt>
                  <dd className="mono mt-1 text-xl font-bold text-foreground">{metric.value}</dd>
                  <dd className="mt-0.5 text-xs text-muted-foreground">{t(metric.hint)}</dd>
                </div>
              ))}
            </dl>
            <Alert tone={VERDICT[result.status].tone} role="status">
              {t(VERDICT[result.status].key)}
              {result.error_code && ERROR_COPY[result.error_code] ? ` ${t(ERROR_COPY[result.error_code])}` : ""}
            </Alert>
            {result.http_status != null && (
              <p className="mono break-words text-xs text-dim">
                {result.provider_message
                  ? t("setup.test.error.detail", { status: String(result.http_status), message: result.provider_message })
                  : t("setup.test.error.detailStatus", { status: String(result.http_status) })}
              </p>
            )}
          </>
        )}
        {test.isError && <Alert tone="danger" role="status">{t("setup.test.error.request")}</Alert>}
      </div>
    </div>
  );
}
