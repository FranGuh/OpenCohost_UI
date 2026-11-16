import type { LlmProviderTestResponse } from "../../api/llmProvider.js";
import { useT } from "../../i18n/t.js";
import { cn } from "../../lib/cn.js";
import { keyTestOutcome } from "./keyTestOutcome.js";

/** One-line result of the two-stage key test, plus a small HTTP detail line on failure. */
export function KeyTestResult({ result, className }: { result: LlmProviderTestResponse; className?: string }) {
  const t = useT();
  const outcome = keyTestOutcome(result, t);
  const ok = outcome.kind === "pass" || outcome.kind === "keyOnly";
  return (
    <span className={cn("flex flex-col gap-0.5", className)}>
      <span role="status" className={cn("text-[12px]", ok ? "text-ok" : "text-warn")}>
        {outcome.line}
      </span>
      {outcome.detail && <span className="text-[11px] text-dim">{outcome.detail}</span>}
    </span>
  );
}
