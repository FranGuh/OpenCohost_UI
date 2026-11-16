import { useState } from "react";
import type { ReactNode } from "react";
import { Card } from "../../ui/Card.js";
import { Badge } from "../../ui/Badge.js";
import { Button } from "../../ui/Button.js";
import { Input } from "../../ui/Input.js";
import { Alert } from "../../ui/Alert.js";
import { Switch } from "../../ui/Switch.js";
import { Segmented } from "../../ui/Segmented.js";
import { ConfirmFooter } from "../../ui/ConfirmFooter.js";
import { SubCollapsibleSection } from "../../ui/Collapsible.js";
import { cn } from "../../lib/cn.js";
import { ApiError, ConflictError, NotFoundError, ValidationError } from "../../api/client.js";
import { useArmCardMutation, useCardsQuery, useCreateCardMutation } from "../../api/editorialCards.js";
import { t, useT } from "../../i18n/t.js";
import {
  ActiveCardActions,
  ActiveCardFactsFields,
  ActiveCardHelper,
  ActiveCardSponsorFields,
  EMPTY_ACTIVE_CARD,
  activeCardCreateFields,
  hasLongLine,
  hasTooManyLines,
  splitLines
} from "./ActiveCardControls.js";
import type { ActiveCardDraft } from "./ActiveCardControls.js";
import { isTerminalStatus, matchesFilter, statusPresentation } from "./editorialCardStatus.js";
import type { CardStatusFilter } from "./editorialCardStatus.js";

const TOPIC_MAX = 120;
const SUMMARY_MAX = 1200;
const TAKE_MAX = 800;

/** Voseo copy per the design's error/edge-case table. Both mutations funnel
 * through here — the subclasses each only ever come from one of the two
 * (ValidationError from create, NotFound/Conflict from arm), so checking
 * every branch on both is harmless. */
function cardErrorMessage(error: Error | null): string {
  if (error instanceof ValidationError) {
    return t("controles.editorialCards.error.validation", { message: error.message });
  }
  if (error instanceof NotFoundError) {
    return t("controles.editorialCards.error.notFound");
  }
  if (error instanceof ConflictError) {
    return t("controles.editorialCards.error.conflict");
  }
  const status = error instanceof ApiError ? error.status : 0;
  if (status === 401) return t("controles.editorialCards.error.unauthorized");
  if (status === 429) return t("controles.editorialCards.error.rateLimited");
  if (status === 503) return t("controles.editorialCards.error.unavailable");
  return t("controles.editorialCards.error.generic");
}

// Shared textarea chrome + growth policy (resize handle + inner scroll past
// the clamp). Two size ramps: narrative fields (summary/take) get a taller
// clamp than the compact one-per-line list fields.
const textareaBase =
  "w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-dim focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring resize-y overflow-y-auto";
const textareaNarrative = `${textareaBase} min-h-[96px] max-h-[240px]`;
const textareaCompact = `${textareaBase} min-h-[64px] max-h-[160px]`;
const fieldLabel = "flex flex-col gap-1 text-[11px] font-semibold text-dim";

/** Visible required marker; the field itself carries aria-required. */
function RequiredMark() {
  return (
    <span aria-hidden="true" className="text-danger">
      {" *"}
    </span>
  );
}

function SectionHint({ children }: { children: ReactNode }) {
  return <p className="text-xs leading-relaxed text-dim">{children}</p>;
}

function ListField({ label, value, onChange }: { label: string; value: string; onChange(next: string): void }) {
  return (
    <label className={fieldLabel}>
      {label}
      <textarea
        aria-label={label}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        rows={2}
        className={textareaCompact}
      />
    </label>
  );
}

const FILTERS: readonly CardStatusFilter[] = ["active", "disabled", "all"];

/**
 * "Tarjetas editoriales" — operator creates a structured editorial cue card
 * (topic/summary/take + optional one-per-line lists) and manages every card.
 * Mirrors MemoriaImportSection (design D3): single ConfirmFooter gate,
 * TanStack Query mutations, per-status error copy. Structured fields only —
 * no raw-paste field — keeps the raw-dump rejection a UX property, not just a
 * 422 (design D1).
 */
export function EditorialCardsCard() {
  const t = useT();
  const [topic, setTopic] = useState("");
  const [summary, setSummary] = useState("");
  const [streamerTake, setStreamerTake] = useState("");
  const [counterpoints, setCounterpoints] = useState("");
  const [discussionHooks, setDiscussionHooks] = useState("");
  const [triggers, setTriggers] = useState("");
  const [singleUse, setSingleUse] = useState(false);
  const [facts, setFacts] = useState<ActiveCardDraft>(EMPTY_ACTIVE_CARD);
  const [confirming, setConfirming] = useState(false);
  const [filter, setFilter] = useState<CardStatusFilter>("active");

  const createMutation = useCreateCardMutation();
  const armMutation = useArmCardMutation();
  const cardsQuery = useCardsQuery();

  const anyLongLine =
    hasLongLine(counterpoints) ||
    hasLongLine(discussionHooks) ||
    hasLongLine(triggers) ||
    hasLongLine(facts.mustSay) ||
    hasLongLine(facts.forbidden);
  const anyTooManyLines =
    hasTooManyLines(counterpoints) ||
    hasTooManyLines(discussionHooks) ||
    hasTooManyLines(triggers) ||
    hasTooManyLines(facts.mustSay) ||
    hasTooManyLines(facts.forbidden);

  // The backend requires all three (EditorialCard._clean_required).
  const missingRequired = [
    [topic, t("controles.editorialCards.topic")],
    [summary, t("controles.editorialCards.summary")],
    [streamerTake, t("controles.editorialCards.streamerTake")]
  ]
    .filter(([value]) => !value.trim())
    .map(([, label]) => label);
  const canSubmit =
    missingRequired.length === 0 && !anyLongLine && !anyTooManyLines && !createMutation.isPending;

  function resetForm() {
    setTopic("");
    setSummary("");
    setStreamerTake("");
    setCounterpoints("");
    setDiscussionHooks("");
    setTriggers("");
    setSingleUse(false);
    setFacts(EMPTY_ACTIVE_CARD);
  }

  function openConfirm() {
    // Drop any prior result/error so a stale notice can't linger into this submit's pending window.
    createMutation.reset();
    setConfirming(true);
  }

  function handleConfirm() {
    setConfirming(false);
    createMutation.mutate(
      {
        agent: "operator",
        topic: topic.trim(),
        summary: summary.trim(),
        streamer_take: streamerTake.trim(),
        counterpoints: splitLines(counterpoints),
        discussion_hooks: splitLines(discussionHooks),
        triggers: splitLines(triggers),
        expires_at: null,
        single_use: singleUse,
        ...activeCardCreateFields(facts)
      },
      { onSuccess: resetForm }
    );
  }

  // GET returns every status; the filter splits live cards (draft/armed/active)
  // from terminal ones (used/expired — disable produces expired).
  const allCards = cardsQuery.data?.cards ?? [];
  const counts: Record<CardStatusFilter, number> = {
    active: allCards.filter((card) => matchesFilter(card.status, "active")).length,
    disabled: allCards.filter((card) => matchesFilter(card.status, "disabled")).length,
    all: allCards.length
  };
  const visibleCards = allCards.filter((card) => matchesFilter(card.status, filter));
  const filterOptions = FILTERS.map((value) => ({
    value,
    label: t(`controles.editorialCards.filter.${value}`, { count: counts[value] })
  }));

  return (
    <Card className="flex flex-col p-4">
      <div className="flex items-center justify-between gap-3 border-b border-border-soft pb-3">
        <h2 className="text-sm font-bold text-foreground">{t("controles.editorialCards.card.title")}</h2>
      </div>

      <div className="flex flex-col gap-3.5 pt-3.5">
        <SubCollapsibleSection title={t("controles.editorialCards.create.eyebrow")} persistKey="editorial-create">
          <div className="space-y-4">
            <section className="space-y-2">
              <h3 className="text-[11px] font-semibold uppercase tracking-[0.09em] text-dim">
                {t("controles.editorialCards.section.content")}
              </h3>
              <SectionHint>{t("controles.editorialCards.section.content.hint")}</SectionHint>
              <label className={fieldLabel}>
                <span>
                  {t("controles.editorialCards.topic")}
                  <RequiredMark />
                </span>
                <Input
                  aria-label={t("controles.editorialCards.topic")}
                  aria-required="true"
                  value={topic}
                  maxLength={TOPIC_MAX}
                  onChange={(event) => setTopic(event.target.value)}
                />
              </label>

              <label className={fieldLabel}>
                <span>
                  {t("controles.editorialCards.summary")}
                  <RequiredMark />
                </span>
                <textarea
                  aria-label={t("controles.editorialCards.summary")}
                  aria-required="true"
                  value={summary}
                  maxLength={SUMMARY_MAX}
                  onChange={(event) => setSummary(event.target.value)}
                  rows={3}
                  className={textareaNarrative}
                />
              </label>

              <label className={fieldLabel}>
                <span>
                  {t("controles.editorialCards.streamerTake")}
                  <RequiredMark />
                </span>
                <textarea
                  aria-label={t("controles.editorialCards.streamerTake")}
                  aria-required="true"
                  value={streamerTake}
                  maxLength={TAKE_MAX}
                  onChange={(event) => setStreamerTake(event.target.value)}
                  rows={3}
                  className={textareaNarrative}
                />
              </label>
            </section>

            <SubCollapsibleSection
              title={t("controles.editorialCards.section.conversation")}
              persistKey="editorial-create-conversation"
            >
              <div className="space-y-2">
                <SectionHint>{t("controles.editorialCards.section.conversation.hint")}</SectionHint>
                <ListField
                  label={t("controles.editorialCards.counterpoints")}
                  value={counterpoints}
                  onChange={setCounterpoints}
                />
                <ListField
                  label={t("controles.editorialCards.discussionHooks")}
                  value={discussionHooks}
                  onChange={setDiscussionHooks}
                />
                <ListField label={t("controles.editorialCards.triggers")} value={triggers} onChange={setTriggers} />
                <div className="flex items-center justify-between gap-3 rounded-md border border-border bg-surface-2 p-3">
                  <div className="flex flex-col gap-0.5">
                    <span className="text-[11px] font-semibold text-foreground">
                      {t("controles.editorialCards.singleUse")}
                    </span>
                    <span className="text-xs leading-relaxed text-dim">
                      {t("controles.editorialCards.singleUse.hint")}
                    </span>
                  </div>
                  <Switch
                    aria-label={t("controles.editorialCards.singleUse")}
                    checked={singleUse}
                    onChange={setSingleUse}
                  />
                </div>
              </div>
            </SubCollapsibleSection>

            <SubCollapsibleSection
              title={t("controles.editorialCards.section.limits")}
              persistKey="editorial-create-limits"
              defaultOpen={false}
            >
              <div className="space-y-2">
                <SectionHint>{t("controles.editorialCards.section.limits.hint")}</SectionHint>
                <ActiveCardFactsFields value={facts} onChange={setFacts} />
                <ActiveCardHelper />
              </div>
            </SubCollapsibleSection>

            <SubCollapsibleSection
              title={t("controles.editorialCards.section.sponsor")}
              persistKey="editorial-create-sponsor"
              defaultOpen={false}
            >
              <div className="space-y-2">
                <SectionHint>{t("controles.editorialCards.section.sponsor.hint")}</SectionHint>
                <ActiveCardSponsorFields value={facts} onChange={setFacts} />
              </div>
            </SubCollapsibleSection>

            <div className="space-y-2">
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

              {createMutation.isError && <Alert tone="danger">{cardErrorMessage(createMutation.error)}</Alert>}
              {createMutation.data && (
                <p className="text-xs leading-relaxed text-foreground">
                  {createMutation.data.demoted
                    ? t("controles.editorialCards.create.success.demoted")
                    : t("controles.editorialCards.create.success")}
                </p>
              )}

              {missingRequired.length > 0 && (
                <p className="text-xs leading-relaxed text-dim">
                  {t("controles.editorialCards.required.missing", { fields: missingRequired.join(", ") })}
                </p>
              )}

              {confirming ? (
                <ConfirmFooter
                  active
                  tone="neutral"
                  stages={[
                    {
                      message: t("controles.editorialCards.create.confirm", { topic: topic.trim() }),
                      advanceLabel: t("controles.editorialCards.create.confirm.action")
                    }
                  ]}
                  onConfirm={handleConfirm}
                  onCancel={() => setConfirming(false)}
                  busy={createMutation.isPending}
                />
              ) : (
                <Button type="button" variant="outline" disabled={!canSubmit} onClick={openConfirm}>
                  {t("controles.editorialCards.create.action")}
                </Button>
              )}
            </div>
          </div>
        </SubCollapsibleSection>

        <SubCollapsibleSection title={t("controles.editorialCards.list.eyebrow")} persistKey="editorial-list">
          <div className="space-y-2">
            <Segmented
              options={filterOptions}
              value={filter}
              onChange={setFilter}
              ariaLabel={t("controles.editorialCards.filter.aria")}
            />
            {cardsQuery.isError && (
              <p role="alert" className="text-xs leading-relaxed text-danger">
                {t("controles.editorialCards.list.error")}
              </p>
            )}
            {armMutation.isError && <Alert tone="danger">{cardErrorMessage(armMutation.error)}</Alert>}
            {armMutation.data && (
              <p className="text-xs leading-relaxed text-foreground">{t("controles.editorialCards.arm.success")}</p>
            )}

            {cardsQuery.isPending ? null : visibleCards.length === 0 ? (
              <p className="text-xs text-dim">{t(`controles.editorialCards.list.empty.${filter}`)}</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {visibleCards.map((card) => {
                  const terminal = isTerminalStatus(card.status);
                  const presentation = statusPresentation(card.status);
                  return (
                    <li
                      key={card.id}
                      data-muted={terminal ? "true" : undefined}
                      className={cn(
                        "grid grid-cols-[1fr_auto_auto] items-center gap-2 rounded-md border border-border p-3",
                        terminal ? "bg-transparent opacity-70" : "bg-surface-2"
                      )}
                    >
                      <span className={cn("text-sm", terminal ? "text-muted-foreground" : "text-foreground")}>
                        {card.topic}
                      </span>
                      <span className="flex items-center gap-1.5">
                        <Badge tone={presentation.tone}>{t(presentation.labelKey)}</Badge>
                        {card.single_use && <Badge tone="warn">{t("controles.editorialCards.badge.singleUse")}</Badge>}
                        {card.active && <Badge tone="ok">{t("controles.editorialCards.active.badge.active")}</Badge>}
                      </span>
                      {card.status === "draft" && (
                        <Button
                          type="button"
                          variant="ghost"
                          disabled={armMutation.isPending}
                          onClick={() => armMutation.mutate(card.id)}
                        >
                          {t("controles.editorialCards.arm.action")}
                        </Button>
                      )}
                      <ActiveCardActions cardId={card.id} active={Boolean(card.active)} terminal={terminal} />
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </SubCollapsibleSection>
      </div>
    </Card>
  );
}
