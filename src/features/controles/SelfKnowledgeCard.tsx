import { useState } from "react";
import { Card } from "../../ui/Card.js";
import { Button } from "../../ui/Button.js";
import { Input } from "../../ui/Input.js";
import { Switch } from "../../ui/Switch.js";
import { useT } from "../../i18n/t.js";
import {
  SelfKnowledgeValidationError,
  isSelfKnowledgeUnavailable,
  useSelfKnowledgeQuery,
  useSelfKnowledgeSave,
  type SelfKnowledgeFieldError,
  type SelfKnowledgeResponse,
  type SelfKnowledgeUpdate
} from "../../api/selfKnowledge.js";

type TextField = "creator" | "repository" | "description";
const TEXT_FIELDS: TextField[] = ["creator", "repository", "description"];

type Draft = Record<TextField, string>;

function errorKey(error: SelfKnowledgeFieldError, field: TextField) {
  if (error.code === "too_long") return "controles.selfKnowledge.field.too_long";
  if (error.code === "unknown") return "controles.selfKnowledge.field.unknown";
  return field === "repository" ? "controles.selfKnowledge.field.invalid" : "controles.selfKnowledge.field.invalid.text";
}

/**
 * Self-knowledge owner controls (GET/PUT /api/self-knowledge). Container: owns
 * the query, the optimistic toggle save, the identity-field draft and inline
 * errors. A backend without the route renders a quiet "not available" note.
 */
export function SelfKnowledgeCard() {
  const t = useT();
  const { data, error: loadError, isError } = useSelfKnowledgeQuery();
  const save = useSelfKnowledgeSave();
  const [draft, setDraft] = useState<Partial<Draft>>({});
  const [fieldErrors, setFieldErrors] = useState<SelfKnowledgeFieldError[]>([]);
  const [saveFailed, setSaveFailed] = useState(false);

  const unavailable = isError && isSelfKnowledgeUnavailable(loadError);
  const valueOf = (d: SelfKnowledgeResponse, f: TextField) => draft[f] ?? d[f];
  const changed = data ? TEXT_FIELDS.filter((f) => draft[f] !== undefined && draft[f] !== data[f]) : [];

  function toggle(update: SelfKnowledgeUpdate) {
    setSaveFailed(false);
    save.mutate(update, { onError: () => setSaveFailed(true) });
  }

  function saveIdentity() {
    if (!data || changed.length === 0) return;
    const update: SelfKnowledgeUpdate = {};
    for (const f of changed) update[f] = draft[f] as string;
    setSaveFailed(false);
    setFieldErrors([]);
    save.mutate(update, {
      onSuccess: () => setDraft({}),
      onError: (e) => {
        if (e instanceof SelfKnowledgeValidationError) setFieldErrors(e.errors);
        else setSaveFailed(true);
      }
    });
  }

  return (
    <Card className="flex flex-col p-4">
      <div className="border-b border-border-soft pb-3">
        <h2 className="text-sm font-bold text-foreground">{t("controles.selfKnowledge.title")}</h2>
      </div>
      <div className="flex flex-col gap-3 pt-3.5">
        {unavailable ? (
          <p className="text-xs leading-relaxed text-muted-foreground">{t("controles.selfKnowledge.unavailable")}</p>
        ) : (
          <p className="text-xs leading-relaxed text-muted-foreground">{t("controles.selfKnowledge.hint")}</p>
        )}
        {(saveFailed || (isError && !unavailable)) && (
          <p role="alert" className="text-xs leading-relaxed text-danger">
            {isError && !unavailable ? t("controles.selfKnowledge.error.load") : t("controles.selfKnowledge.error.save")}
          </p>
        )}
        {data && (
          <>
            <SwitchRow
              label={t("controles.selfKnowledge.master")}
              hint={t("controles.selfKnowledge.master.hint")}
              checked={data.enabled}
              disabled={save.isPending}
              onChange={(enabled) => toggle({ enabled })}
            />
            <SwitchRow
              label={t("controles.selfKnowledge.viewers")}
              hint={t("controles.selfKnowledge.viewers.hint")}
              checked={data.viewers}
              disabled={save.isPending || !data.enabled}
              onChange={(viewers) => toggle({ viewers })}
            />
            <div className="flex flex-col gap-2.5 border-t border-border-soft pt-3">
              <span className="text-sm font-medium text-foreground">{t("controles.selfKnowledge.identity")}</span>
              <span className="text-xs leading-relaxed text-muted-foreground">{t("controles.selfKnowledge.identity.hint")}</span>
              {TEXT_FIELDS.map((f) => {
                const err = fieldErrors.find((e) => e.field === f);
                const id = `self-knowledge-${f}`;
                return (
                  <div key={f} className="flex flex-col gap-1">
                    <label htmlFor={id} className="text-xs text-muted-foreground">
                      {t(`controles.selfKnowledge.${f}`)}
                    </label>
                    <Input
                      id={id}
                      value={valueOf(data, f)}
                      placeholder={f === "description" ? undefined : data.defaults[f]}
                      aria-invalid={err ? true : undefined}
                      aria-describedby={err ? `${id}-error` : undefined}
                      disabled={save.isPending}
                      onChange={(e) => {
                        setDraft({ ...draft, [f]: e.target.value });
                        setFieldErrors((prev) => prev.filter((x) => x.field !== f));
                      }}
                    />
                    {err && (
                      <span id={`${id}-error`} className="text-xs text-danger">
                        {t(errorKey(err, f))}
                      </span>
                    )}
                  </div>
                );
              })}
              <div>
                <Button variant="primary" disabled={changed.length === 0 || save.isPending} onClick={saveIdentity}>
                  {save.isPending ? t("controles.selfKnowledge.saving") : t("controles.selfKnowledge.save")}
                </Button>
              </div>
            </div>
          </>
        )}
      </div>
    </Card>
  );
}

interface SwitchRowProps {
  label: string;
  hint: string;
  checked: boolean;
  disabled: boolean;
  onChange: (checked: boolean) => void;
}

function SwitchRow({ label, hint, checked, disabled, onChange }: SwitchRowProps) {
  return (
    <div className="grid grid-cols-[1fr_auto] items-center gap-3">
      <div className="flex flex-col gap-0.5">
        <span className="text-[13px] text-foreground">{label}</span>
        <span className="text-[11px] leading-tight text-dim">{hint}</span>
      </div>
      <Switch checked={checked} disabled={disabled} onChange={onChange} aria-label={label} />
    </div>
  );
}
