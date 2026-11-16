import { useState } from "react";
import { Card } from "../../ui/Card.js";
import { CollapsibleHeader, CollapsibleBody, useCollapsible } from "../../ui/Collapsible.js";
import { useT } from "../../i18n/t.js";
import { useGuardrailsQuery, useGuardrailsSave } from "../../api/guardrails.js";
import { GuardrailsList } from "./GuardrailsList.js";

/**
 * Output guardrails (GET/PUT /api/guardrails). Container: owns the query, the
 * optimistic save and the inline error; GuardrailsList is presentational.
 * Every toggle sends the FULL disabled list (the endpoint is a full replace).
 */
export function GuardrailsCard() {
  const t = useT();
  const { data, isError: loadError } = useGuardrailsQuery();
  const save = useGuardrailsSave();
  const [saveFailed, setSaveFailed] = useState(false);
  const [isOpen, toggleOpen] = useCollapsible(true, "guardrails");
  const bodyId = "oc-collapsible-body-guardrails";

  function toggle(id: string, enabled: boolean) {
    if (!data) return;
    const disabled = data.rules.filter((r) => r.tier === "toggleable" && !r.enabled && r.id !== id).map((r) => r.id);
    if (!enabled) disabled.push(id);
    setSaveFailed(false);
    save.mutate(disabled, { onError: () => setSaveFailed(true) });
  }

  const activeCount = data ? data.rules.filter((r) => r.enabled).length : 0;
  const totalCount = data ? data.rules.length : 0;

  return (
    <Card className="flex flex-col p-4">
      <CollapsibleHeader isOpen={isOpen} onToggle={toggleOpen} bodyId={bodyId}>
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-bold text-foreground">{t("controles.guardrails.title")}</h2>
          {data && (
            <span className="rounded-full bg-muted/60 px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
              {activeCount}/{totalCount}
            </span>
          )}
        </div>
      </CollapsibleHeader>
      <CollapsibleBody isOpen={isOpen} id={bodyId}>
        <div className="flex flex-col gap-3">
          <p className="text-xs leading-relaxed text-muted-foreground">{t("controles.guardrails.hint")}</p>
          {(loadError || saveFailed) && (
            <p role="alert" className="text-xs leading-relaxed text-danger">
              {loadError ? t("controles.guardrails.error.load") : t("controles.guardrails.error.save")}
            </p>
          )}
          {data && <GuardrailsList rules={data.rules} busy={save.isPending} onToggle={toggle} />}
        </div>
      </CollapsibleBody>
    </Card>
  );
}
