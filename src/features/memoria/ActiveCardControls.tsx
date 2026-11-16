import { useEffect, useRef, useState } from "react";
import { Alert } from "../../ui/Alert.js";
import { Button } from "../../ui/Button.js";
import { Input } from "../../ui/Input.js";
import { ConfirmFooter } from "../../ui/ConfirmFooter.js";
import { ApiError, ConflictError, NotFoundError, ValidationError } from "../../api/client.js";
import {
  ActiveCardUnavailableError,
  getActiveCard,
  useDeleteCardMutation,
  useDisableCardMutation,
  useActivateCardMutation,
  useSaveCardFieldsMutation,
  useDeactivateCardMutation
} from "../../api/editorialCards.js";
import type { ActiveCardFieldsUpdate } from "../../api/editorialCards.js";
import { useT } from "../../i18n/t.js";

const textarea =
  "w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-dim focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring resize-y overflow-y-auto min-h-[64px] max-h-[160px]";

export const CARD_LIST_LINE_MAX = 240;
export const CARD_LIST_MAX_LINES = 8;

/** One item per line, trimmed, blanks dropped (same rule as the card form). */
export function splitLines(value: string): string[] {
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

export function hasLongLine(value: string): boolean {
  return splitLines(value).some((line) => line.length > CARD_LIST_LINE_MAX);
}

export function hasTooManyLines(value: string): boolean {
  return splitLines(value).length > CARD_LIST_MAX_LINES;
}

export interface ActiveCardDraft {
  mustSay: string;
  forbidden: string;
  discountCode: string;
  link: string;
}

export const EMPTY_ACTIVE_CARD: ActiveCardDraft = { mustSay: "", forbidden: "", discountCode: "", link: "" };

export function activeCardUpdateBody(draft: ActiveCardDraft): Required<ActiveCardFieldsUpdate> {
  return {
    must_say: splitLines(draft.mustSay),
    forbidden_claims: splitLines(draft.forbidden),
    discount_code: draft.discountCode.trim(),
    link: draft.link.trim()
  };
}

/** Create-form body: only the verified-facts fields that were actually filled. */
export function activeCardCreateFields(draft: ActiveCardDraft): ActiveCardFieldsUpdate {
  const body = activeCardUpdateBody(draft);
  const out: ActiveCardFieldsUpdate = {};
  if (body.must_say.length) out.must_say = body.must_say;
  if (body.forbidden_claims.length) out.forbidden_claims = body.forbidden_claims;
  if (body.discount_code) out.discount_code = body.discount_code;
  if (body.link) out.link = body.link;
  return out;
}

interface ActiveCardFieldsProps {
  value: ActiveCardDraft;
  onChange(next: ActiveCardDraft): void;
}

/** Must-say facts + forbidden phrases ("Datos y límites" in the create form). */
export function ActiveCardFactsFields({ value, onChange }: ActiveCardFieldsProps) {
  const t = useT();
  const set = (patch: Partial<ActiveCardDraft>) => onChange({ ...value, ...patch });
  return (
    <div className="space-y-2">
      <label className="flex flex-col gap-1 text-[11px] font-semibold text-dim">
        {t("controles.editorialCards.active.mustSay")}
        <textarea
          aria-label={t("controles.editorialCards.active.mustSay")}
          value={value.mustSay}
          onChange={(event) => set({ mustSay: event.target.value })}
          rows={2}
          className={textarea}
        />
      </label>
      <label className="flex flex-col gap-1 text-[11px] font-semibold text-dim">
        {t("controles.editorialCards.active.forbidden")}
        <textarea
          aria-label={t("controles.editorialCards.active.forbidden")}
          value={value.forbidden}
          onChange={(event) => set({ forbidden: event.target.value })}
          rows={2}
          className={textarea}
        />
      </label>
    </div>
  );
}

/** Discount code + link ("Código y enlace" in the create form). */
export function ActiveCardSponsorFields({ value, onChange }: ActiveCardFieldsProps) {
  const t = useT();
  const set = (patch: Partial<ActiveCardDraft>) => onChange({ ...value, ...patch });
  return (
    <div className="space-y-2">
      <label className="flex flex-col gap-1 text-[11px] font-semibold text-dim">
        {t("controles.editorialCards.active.discountCode")}
        <Input
          aria-label={t("controles.editorialCards.active.discountCode")}
          value={value.discountCode}
          onChange={(event) => set({ discountCode: event.target.value })}
        />
      </label>
      <label className="flex flex-col gap-1 text-[11px] font-semibold text-dim">
        {t("controles.editorialCards.active.link")}
        <Input
          aria-label={t("controles.editorialCards.active.link")}
          value={value.link}
          onChange={(event) => set({ link: event.target.value })}
        />
      </label>
    </div>
  );
}

/** Explanatory note on active cards and banned phrases. */
export function ActiveCardHelper() {
  const t = useT();
  return <p className="text-xs leading-relaxed text-dim">{t("controles.editorialCards.active.helper")}</p>;
}

/** All verified-facts fields in one block (the per-row editor). */
export function ActiveCardFields(props: ActiveCardFieldsProps) {
  return (
    <div className="space-y-2">
      <ActiveCardFactsFields {...props} />
      <ActiveCardSponsorFields {...props} />
      <ActiveCardHelper />
    </div>
  );
}

function ActiveCardError({ error }: { error: Error | null }) {
  const t = useT();
  if (!error) return null;
  // Quiet note, not an alert: the connected backend predates the routes.
  if (error instanceof ActiveCardUnavailableError) {
    return <p className="text-xs leading-relaxed text-dim">{t("controles.editorialCards.active.unavailable")}</p>;
  }
  let message: string;
  if (error instanceof ValidationError) {
    message = t("controles.editorialCards.error.validation", { message: error.message });
  } else if (error instanceof NotFoundError) {
    message = t("controles.editorialCards.error.notFound");
  } else if (error instanceof ConflictError) {
    message = t("controles.editorialCards.active.error.conflict");
  } else if (error instanceof ApiError && error.status === 401) {
    message = t("controles.editorialCards.error.unauthorized");
  } else if (error instanceof ApiError && error.status === 503) {
    message = t("controles.editorialCards.error.unavailable");
  } else {
    message = t("controles.editorialCards.error.generic");
  }
  return <Alert tone="danger">{message}</Alert>;
}

/** Edits the verified facts of an existing card: GET the full card (the list
 * is a light projection), then PUT what the operator saves. */
export function ActiveCardEditor({ cardId }: { cardId: string }) {
  const t = useT();
  const [draft, setDraft] = useState<ActiveCardDraft | null>(null);
  const [loadError, setLoadError] = useState<Error | null>(null);
  const save = useSaveCardFieldsMutation();
  const resetSaveRef = useRef(save.reset);
  resetSaveRef.current = save.reset;

  useEffect(() => {
    let cancelled = false;
    setLoadError(null);
    setDraft(null);
    resetSaveRef.current();
    getActiveCard(cardId)
      .then((card) => {
        if (cancelled) return;
        setLoadError(null);
        setDraft({
          mustSay: card.must_say.join("\n"),
          forbidden: card.forbidden_claims.join("\n"),
          discountCode: card.discount_code,
          link: card.link
        });
      })
      .catch((error: Error) => {
        if (!cancelled) setLoadError(error);
      });
    return () => {
      cancelled = true;
    };
  }, [cardId]);

  if (loadError) return <ActiveCardError error={loadError} />;
  if (!draft) return <p className="text-xs text-dim">{t("controles.editorialCards.active.loading")}</p>;

  const anyLongLine = hasLongLine(draft.mustSay) || hasLongLine(draft.forbidden);
  const anyTooManyLines = hasTooManyLines(draft.mustSay) || hasTooManyLines(draft.forbidden);

  function handleDraftChange(next: ActiveCardDraft) {
    if (save.isSuccess || save.isError) save.reset();
    setDraft(next);
  }

  return (
    <div className="space-y-2">
      <ActiveCardFields value={draft} onChange={handleDraftChange} />
      {anyLongLine && (
        <p role="alert" className="text-xs leading-relaxed text-danger">
          {t("controles.editorialCards.lineTooLong.hint")}
        </p>
      )}
      {anyTooManyLines && (
        <p role="alert" className="text-xs leading-relaxed text-danger">
          {t("controles.editorialCards.tooManyLines.hint")}
        </p>
      )}
      <ActiveCardError error={save.error} />
      {save.isSuccess && (
        <p className="text-xs leading-relaxed text-foreground">{t("controles.editorialCards.active.saved")}</p>
      )}
      <Button
        type="button"
        variant="outline"
        disabled={save.isPending || anyLongLine || anyTooManyLines}
        onClick={() => save.mutate({ id: cardId, fields: activeCardUpdateBody(draft) })}
      >
        {t("controles.editorialCards.active.save")}
      </Button>
    </div>
  );
}

type Confirming = "disable" | "delete" | null;

/** Activate/deactivate, disable, delete (both behind a confirm step) and the
 * verified-facts editor for one list row. Spans the full row below its main line.
 * A `terminal` card (used/expired) keeps only Delete, plus Deactivate while it is
 * still flagged active: the backend refuses to activate an expired card and to
 * disable a used one, and there is no re-enable route. */
export function ActiveCardActions({
  cardId,
  active,
  terminal = false
}: {
  cardId: string;
  active: boolean;
  terminal?: boolean;
}) {
  const t = useT();
  const [confirming, setConfirming] = useState<Confirming>(null);
  const [editing, setEditing] = useState(false);
  const activate = useActivateCardMutation();
  const deactivate = useDeactivateCardMutation();
  const disable = useDisableCardMutation();
  const del = useDeleteCardMutation();
  const busy = activate.isPending || deactivate.isPending || disable.isPending || del.isPending;
  const error = activate.error ?? deactivate.error ?? disable.error ?? del.error;

  function resetErrors() {
    activate.reset();
    deactivate.reset();
    disable.reset();
    del.reset();
  }

  function ask(action: Exclude<Confirming, null>) {
    resetErrors();
    setConfirming(action);
  }

  return (
    <div className="col-span-full flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-1.5">
        {active ? (
          <Button
            type="button"
            variant="ghost"
            disabled={busy}
            onClick={() => {
              resetErrors();
              deactivate.mutate(cardId);
            }}
          >
            {t("controles.editorialCards.active.deactivate")}
          </Button>
        ) : terminal ? null : (
          <Button
            type="button"
            variant="ghost"
            disabled={busy}
            onClick={() => {
              resetErrors();
              activate.mutate(cardId);
            }}
          >
            {t("controles.editorialCards.active.activate")}
          </Button>
        )}
        {!terminal && (
          <>
            <Button type="button" variant="ghost" aria-expanded={editing} onClick={() => setEditing((v) => !v)}>
              {t("controles.editorialCards.active.edit")}
            </Button>
            <Button type="button" variant="ghost" disabled={busy} onClick={() => ask("disable")}>
              {t("controles.editorialCards.active.disable")}
            </Button>
          </>
        )}
        <Button type="button" variant="ghost" disabled={busy} onClick={() => ask("delete")}>
          {t("controles.editorialCards.active.delete")}
        </Button>
      </div>
      <ActiveCardError error={error} />
      {confirming && (
        <ConfirmFooter
          active
          tone={confirming === "delete" ? "danger" : "neutral"}
          stages={[
            {
              message: t(
                confirming === "delete"
                  ? "controles.editorialCards.active.delete.confirm"
                  : "controles.editorialCards.active.disable.confirm"
              ),
              advanceLabel: t("controles.editorialCards.create.confirm.action")
            }
          ]}
          onConfirm={() => {
            const action = confirming;
            setConfirming(null);
            if (action === "delete") del.mutate(cardId);
            else disable.mutate(cardId);
          }}
          onCancel={() => setConfirming(null)}
          busy={busy}
        />
      )}
      {editing && !terminal && <ActiveCardEditor cardId={cardId} />}
    </div>
  );
}
