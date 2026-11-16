import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { Card } from "../../ui/Card.js";
import { Button } from "../../ui/Button.js";
import { Badge } from "../../ui/Badge.js";
import { useT } from "../../i18n/t.js";
import { useUiLocale } from "../../i18n/locale.js";
import { getI18nState } from "../../api/i18n.js";
import { primaryLocale } from "../../api/profiles.js";
import {
  PronunciationValidationError,
  usePronunciationQuery,
  usePronunciationSave,
  type PronunciationFieldError,
  type PronunciationLimits
} from "../../api/pronunciation.js";
import { classifySpeechError, postSpeechSay, type SpeechErrorKind } from "../../api/speech.js";
import { PronunciationTable } from "./PronunciationTable.js";
import { validatePronunciationRows, type PronunciationRow, type RowErrorMap } from "./pronunciationRules.js";

const FALLBACK_LIMITS: PronunciationLimits = { max_entries: 200, match_max: 64, replace_max: 128 };

const PREVIEW_ERROR_KEY = {
  guard: "controles.pronunciation.preview.guard",
  unavailable: "controles.pronunciation.preview.unavailable",
  invalid: "controles.pronunciation.preview.invalid",
  generic: "controles.pronunciation.preview.generic"
} as const satisfies Record<SpeechErrorKind, string>;

const sameRows = (a: { match: string; replace: string }[], b: { match: string; replace: string }[]) =>
  a.length === b.length && a.every((e, i) => e.match === b[i].match && e.replace === b[i].replace);

/**
 * Pronunciation dictionary editor (GET/PUT /api/tts/pronunciation). Holds a
 * draft only while the operator edits; `draft === null` means "showing the
 * saved list". Preview speaks the SAVED word through read-aloud, because the
 * backend sanitizer applies the saved dictionary.
 */
export function PronunciationCard() {
  const t = useT();
  const { locale: uiLocale } = useUiLocale();
  const i18nQuery = useQuery({ queryKey: ["i18n"], queryFn: getI18nState, staleTime: 60_000 });
  const i18nSettled = !i18nQuery.isPending;
  const runtimeLocale = primaryLocale((i18nQuery.data?.active_locale ?? "").trim() || uiLocale) || uiLocale;
  const { data, isError: loadError } = usePronunciationQuery(runtimeLocale, { enabled: i18nSettled });
  const save = usePronunciationSave(runtimeLocale);
  const limits = data?.limits ?? FALLBACK_LIMITS;
  const nextId = useRef(0);

  const [draft, setDraft] = useState<PronunciationRow[] | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [serverErrors, setServerErrors] = useState<RowErrorMap>({});
  const [saveFailed, setSaveFailed] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [previewError, setPreviewError] = useState<SpeechErrorKind | null>(null);

  useEffect(() => {
    setDraft(null);
    setShowAll(false);
    setServerErrors({});
    setSaveFailed(false);
    setConfirmClear(false);
    setPreviewError(null);
  }, [runtimeLocale]);

  const savedEntries = data?.entries;
  const savedRows = useMemo<PronunciationRow[]>(
    () => (savedEntries ?? []).map((e, i) => ({ id: `saved-${i}`, ...e })),
    [savedEntries]
  );
  const rows = draft ?? savedRows;
  const dirty = draft !== null && !sameRows(draft, savedRows);

  const clientErrors = useMemo(() => validatePronunciationRows(rows, limits), [rows, limits]);
  const visibleErrors = useMemo<RowErrorMap>(() => {
    const out: RowErrorMap = {};
    for (const [id, errs] of Object.entries(clientErrors)) {
      const shown = { ...errs };
      if (!showAll && shown.match === "empty") delete shown.match;
      if (shown.match || shown.replace) out[id] = shown;
    }
    for (const [id, errs] of Object.entries(serverErrors)) out[id] = { ...errs, ...out[id] };
    return out;
  }, [clientErrors, serverErrors, showAll]);

  const savedIds = useMemo(() => {
    const keys = new Set((savedEntries ?? []).map((e) => `${e.match}\u0000${e.replace}`));
    return new Set(rows.filter((r) => r.match !== "" && keys.has(`${r.match}\u0000${r.replace}`)).map((r) => r.id));
  }, [rows, savedEntries]);

  function edit(update: (rows: PronunciationRow[]) => PronunciationRow[]) {
    setDraft(update(rows));
    setSaveFailed(false);
    setConfirmClear(false);
  }

  function changeCell(id: string, field: "match" | "replace", value: string) {
    edit((rs) => rs.map((r) => (r.id === id ? { ...r, [field]: value } : r)));
    setServerErrors((prev) => {
      if (!prev[id]) return prev;
      const { [id]: _dropped, ...rest } = prev;
      return rest;
    });
  }

  function addRow() {
    nextId.current += 1;
    edit((rs) => [...rs, { id: `new-${nextId.current}`, match: "", replace: "" }]);
  }

  function discard() {
    setDraft(null);
    setShowAll(false);
    setServerErrors({});
    setSaveFailed(false);
    setConfirmClear(false);
  }

  function onSave() {
    if (Object.keys(clientErrors).length > 0) {
      setShowAll(true);
      return;
    }
    setSaveFailed(false);
    setServerErrors({});
    const entries = rows.map((r) => ({ match: r.match.trim(), replace: r.replace }));
    save.mutate(entries, {
      onSuccess: () => {
        setDraft(null);
        setShowAll(false);
      },
      onError: (error) => {
        if (error instanceof PronunciationValidationError && error.errors.length > 0) {
          const mapped: RowErrorMap = {};
          for (const e of error.errors as PronunciationFieldError[]) {
            const row = rows[e.index];
            if (row && (e.field === "match" || e.field === "replace")) {
              mapped[row.id] = { ...mapped[row.id], [e.field]: e.code };
            }
          }
          setServerErrors(mapped);
          if (Object.keys(mapped).length > 0) return;
        }
        setSaveFailed(true);
      }
    });
  }

  function preview(id: string) {
    const row = rows.find((r) => r.id === id);
    if (!row) return;
    setPreviewError(null);
    postSpeechSay(row.match, "now").catch((error: unknown) => setPreviewError(classifySpeechError(error)));
  }

  const busy = save.isPending;

  return (
    <Card className="flex flex-col p-4">
      <div className="flex items-center justify-between gap-3 border-b border-border-soft pb-3">
        <h2 className="text-sm font-bold text-foreground">{t("controles.pronunciation.title")}</h2>
        {dirty && <Badge tone="info">{t("controles.pronunciation.dirty")}</Badge>}
      </div>

      <div className="flex flex-col gap-3 pt-3.5">
        <p className="text-xs leading-relaxed text-muted-foreground">{t("controles.pronunciation.hint")}</p>

        {(loadError || saveFailed) && (
          <p role="alert" className="text-xs leading-relaxed text-danger">
            {loadError ? t("controles.pronunciation.error.load") : t("controles.pronunciation.error.save")}
          </p>
        )}

        {rows.length === 0 ? (
          <p className="rounded-md border border-dashed border-border-soft p-3 text-xs leading-relaxed text-dim">
            {t("controles.pronunciation.empty")}
          </p>
        ) : (
          <PronunciationTable
            rows={rows}
            errors={visibleErrors}
            savedIds={savedIds}
            limits={limits}
            disabled={busy}
            onChange={changeCell}
            onDelete={(id) => edit((rs) => rs.filter((r) => r.id !== id))}
            onPreview={preview}
          />
        )}

        {previewError && (
          <p role="status" className="text-xs text-danger">
            {t(PREVIEW_ERROR_KEY[previewError])}
          </p>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <Button disabled={busy || rows.length >= limits.max_entries} onClick={addRow}>
            <Plus size={14} aria-hidden="true" />
            {t("controles.pronunciation.add")}
          </Button>
          <Button variant="primary" disabled={!dirty || busy} onClick={onSave}>
            {busy ? t("controles.pronunciation.saving") : t("controles.pronunciation.save")}
          </Button>
          <Button variant="ghost" disabled={!dirty || busy} onClick={discard}>
            {t("controles.pronunciation.discard")}
          </Button>
          {!confirmClear ? (
            <Button variant="ghost" disabled={rows.length === 0 || busy} onClick={() => setConfirmClear(true)}>
              {t("controles.pronunciation.clearAll")}
            </Button>
          ) : (
            <span role="group" aria-label={t("controles.pronunciation.clearConfirm")} className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">{t("controles.pronunciation.clearConfirm")}</span>
              <Button
                variant="outline"
                onClick={() => {
                  edit(() => []);
                  setServerErrors({});
                }}
              >
                {t("controles.pronunciation.clearYes")}
              </Button>
              <Button variant="ghost" onClick={() => setConfirmClear(false)}>
                {t("controles.pronunciation.cancel")}
              </Button>
            </span>
          )}
        </div>
      </div>
    </Card>
  );
}
