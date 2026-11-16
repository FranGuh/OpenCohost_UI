import { Lock } from "lucide-react";
import { Switch } from "../../ui/Switch.js";
import { useT } from "../../i18n/t.js";
import type { GuardrailRule } from "../../api/guardrails.js";
import { GUARDRAIL_COPY } from "./guardrailCopy.js";

export interface GuardrailsListProps {
  rules: GuardrailRule[];
  /** True while a save is in flight: every switch is disabled. */
  busy: boolean;
  onToggle: (id: string, enabled: boolean) => void;
}

/** Toggleable rules first, locked ones after; order within a group is the API's. */
function ordered(rules: GuardrailRule[]): GuardrailRule[] {
  return [...rules.filter((r) => r.tier === "toggleable"), ...rules.filter((r) => r.tier !== "toggleable")];
}

/** Presentational list: tier decides the control, never the rule id. */
export function GuardrailsList({ rules, busy, onToggle }: GuardrailsListProps) {
  const t = useT();
  return (
    <ul className="flex flex-col gap-2">
      {ordered(rules).map((rule) => {
        const copy = GUARDRAIL_COPY[rule.id];
        const name = copy ? t(copy.name) : rule.id;
        const desc = copy ? t(copy.desc) : t("controles.guardrails.unknown.desc");
        const toggleable = rule.tier === "toggleable";
        return (
          <li
            key={rule.id}
            data-testid={`guardrail-rule-${rule.id}`}
            className="flex items-start justify-between gap-3 rounded-md border border-border-soft p-3"
          >
            <div className="flex min-w-0 flex-col gap-1">
              <span className="flex items-center gap-1.5 text-sm font-medium text-foreground">
                {!toggleable && <Lock size={13} aria-hidden="true" data-testid="guardrail-lock" className="text-dim" />}
                {name}
              </span>
              <span className="text-xs leading-relaxed text-muted-foreground">{desc}</span>
              <span className="text-xs leading-relaxed text-dim">
                {toggleable
                  ? t(copy?.note ?? "controles.guardrails.note.default")
                  : t("controles.guardrails.locked.reason")}
              </span>
            </div>
            {toggleable && (
              <Switch
                aria-label={name}
                checked={rule.enabled}
                disabled={busy}
                onChange={(checked) => onToggle(rule.id, checked)}
              />
            )}
          </li>
        );
      })}
    </ul>
  );
}
