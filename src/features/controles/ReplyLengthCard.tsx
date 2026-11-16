import { useId, useState } from "react";
import { Card } from "../../ui/Card.js";
import { Segmented } from "../../ui/Segmented.js";
import { useT } from "../../i18n/t.js";
import { useReplyLengthQuery, useReplyLengthSave, type ReplyLengthMode } from "../../api/replyLength.js";

const COPY = {
  auto: { label: "controles.replyLength.option.auto", hint: "controles.replyLength.hint.auto" },
  short: { label: "controles.replyLength.option.short", hint: "controles.replyLength.hint.short" },
  medium: { label: "controles.replyLength.option.medium", hint: "controles.replyLength.hint.medium" },
  long: { label: "controles.replyLength.option.long", hint: "controles.replyLength.hint.long" },
  very_long: { label: "controles.replyLength.option.veryLong", hint: "controles.replyLength.hint.veryLong" }
} as const satisfies Record<ReplyLengthMode, { label: string; hint: string }>;

const MODES = Object.keys(COPY) as ReplyLengthMode[];

/**
 * Reply length (GET/PUT /api/reply-length). Container: owns the query, the
 * optimistic save and the inline error. Each change saves immediately. When
 * the GET fails the control stays visible but disabled, next to the error.
 */
export function ReplyLengthCard() {
  const t = useT();
  const hintId = useId();
  const { data, isError: loadError, isPending } = useReplyLengthQuery();
  const save = useReplyLengthSave();
  const [saveFailed, setSaveFailed] = useState(false);

  const options = MODES.map((value) => ({ value, label: t(COPY[value].label) }));
  const selected = data?.mode ?? null;

  function change(mode: ReplyLengthMode) {
    if (mode === selected) return;
    setSaveFailed(false);
    save.mutate(mode, { onError: () => setSaveFailed(true) });
  }

  return (
    <Card className="flex flex-col p-4">
      <div className="border-b border-border-soft pb-3">
        <h2 className="text-sm font-bold text-foreground">{t("controles.replyLength.title")}</h2>
      </div>
      <div className="flex flex-col gap-3 pt-3.5">
        {isPending ? (
          <p className="text-xs leading-relaxed text-muted-foreground">{t("controles.replyLength.loading")}</p>
        ) : (
          <>
            <Segmented
              options={options}
              value={selected}
              onChange={change}
              ariaLabel={t("controles.replyLength.title")}
              ariaDescribedBy={selected ? hintId : undefined}
              disabled={loadError || !data}
            />
            {selected && (
              <p id={hintId} className="text-xs leading-relaxed text-muted-foreground">
                {t(COPY[selected].hint)}
              </p>
            )}
          </>
        )}
        {(loadError || saveFailed) && (
          <p role="alert" className="text-xs leading-relaxed text-danger">
            {loadError ? t("controles.replyLength.error.load") : t("controles.replyLength.error.save")}
          </p>
        )}
        <p className="text-xs leading-relaxed text-muted-foreground">{t("controles.replyLength.note")}</p>
      </div>
    </Card>
  );
}
