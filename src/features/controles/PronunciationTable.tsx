import { Play, Trash2 } from "lucide-react";
import { Button } from "../../ui/Button.js";
import { Input } from "../../ui/Input.js";
import { useT } from "../../i18n/t.js";
import type { PronunciationLimits } from "../../api/pronunciation.js";
import type { PronunciationRow, RowErrorMap } from "./pronunciationRules.js";

export interface PronunciationTableProps {
  rows: PronunciationRow[];
  /** Errors already filtered to what should be visible now. */
  errors: RowErrorMap;
  /** Row ids whose current value equals a saved server entry (previewable). */
  savedIds: ReadonlySet<string>;
  limits: PronunciationLimits;
  disabled?: boolean;
  onChange: (id: string, field: "match" | "replace", value: string) => void;
  onDelete: (id: string) => void;
  onPreview: (id: string) => void;
}

/** Presentational editable table: no data fetching, no validation of its own. */
export function PronunciationTable({
  rows,
  errors,
  savedIds,
  limits,
  disabled,
  onChange,
  onDelete,
  onPreview
}: PronunciationTableProps) {
  const t = useT();

  function message(code: string | undefined): string | null {
    if (!code) return null;
    switch (code) {
      case "empty":
        return t("controles.pronunciation.error.empty");
      case "too_long":
        return t("controles.pronunciation.error.tooLong");
      case "duplicate":
        return t("controles.pronunciation.error.duplicate");
      case "forbidden_char":
        return t("controles.pronunciation.error.forbidden");
      default:
        return t("controles.pronunciation.error.invalid");
    }
  }

  return (
    <div role="group" aria-label={t("controles.pronunciation.table.aria")} className="flex flex-col gap-2">
      <div className="grid grid-cols-[1fr_1fr_auto] gap-2 px-0.5 text-[11px] font-semibold uppercase tracking-[0.09em] text-dim">
        <span>{t("controles.pronunciation.col.match")}</span>
        <span>{t("controles.pronunciation.col.replace")}</span>
        <span className="w-[4.75rem]" aria-hidden="true" />
      </div>
      {rows.map((row, i) => {
        const n = i + 1;
        const rowErrors = errors[row.id] ?? {};
        const matchMsg = message(rowErrors.match);
        const replaceMsg = message(rowErrors.replace);
        const saved = savedIds.has(row.id);
        return (
          <div key={row.id} className="grid grid-cols-[1fr_1fr_auto] items-start gap-2">
            <div data-cell className="flex flex-col gap-1">
              <Input
                className="h-9"
                value={row.match}
                maxLength={limits.match_max + 16}
                disabled={disabled}
                aria-label={t("controles.pronunciation.row.match", { n })}
                aria-invalid={matchMsg ? true : undefined}
                aria-describedby={matchMsg ? `pron-${row.id}-match-err` : undefined}
                onChange={(e) => onChange(row.id, "match", e.target.value)}
              />
              {matchMsg && (
                <span id={`pron-${row.id}-match-err`} className="text-[11px] text-danger">
                  {matchMsg}
                </span>
              )}
            </div>
            <div data-cell className="flex flex-col gap-1">
              <Input
                className="h-9"
                value={row.replace}
                disabled={disabled}
                aria-label={t("controles.pronunciation.row.replace", { n })}
                aria-invalid={replaceMsg ? true : undefined}
                aria-describedby={replaceMsg ? `pron-${row.id}-replace-err` : undefined}
                onChange={(e) => onChange(row.id, "replace", e.target.value)}
              />
              {replaceMsg && (
                <span id={`pron-${row.id}-replace-err`} className="text-[11px] text-danger">
                  {replaceMsg}
                </span>
              )}
            </div>
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                className="h-9 w-9 px-0"
                disabled={!saved}
                title={saved ? undefined : t("controles.pronunciation.testSaveHint")}
                aria-label={t("controles.pronunciation.row.test", { n })}
                onClick={() => onPreview(row.id)}
              >
                <Play size={14} aria-hidden="true" />
              </Button>
              <Button
                variant="ghost"
                className="h-9 w-9 px-0"
                disabled={disabled}
                aria-label={t("controles.pronunciation.row.delete", { n })}
                onClick={() => onDelete(row.id)}
              >
                <Trash2 size={14} aria-hidden="true" />
              </Button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
