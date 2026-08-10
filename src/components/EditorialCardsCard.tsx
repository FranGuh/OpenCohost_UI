import { useState } from "react";
import { Card } from "../ui/Card.js";
import { Badge } from "../ui/Badge.js";
import { Button } from "../ui/Button.js";
import { Input } from "../ui/Input.js";
import { Alert } from "../ui/Alert.js";
import { ConfirmFooter } from "../ui/ConfirmFooter.js";
import { SubCollapsibleSection } from "../ui/Collapsible.js";
import { ApiError, ConflictError, NotFoundError, ValidationError } from "../api/client.js";
import { useArmCardMutation, useCardsQuery, useCreateCardMutation } from "../api/editorialCards.js";

const TOPIC_MAX = 120;
const SUMMARY_MAX = 1200;
const TAKE_MAX = 800;
const LIST_LINE_MAX = 240;
const LIST_MAX_LINES = 8;

/** One item per line, trimmed, blanks dropped. Does not collapse internal
 * whitespace like the backend's EditorialCard._clean_list; per-line length
 * and line-count caps (LIST_LINE_MAX, LIST_MAX_LINES below) are enforced
 * separately by hasLongLine/hasTooManyLines. */
function splitLines(value: string): string[] {
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function hasLongLine(value: string): boolean {
  return splitLines(value).some((line) => line.length > LIST_LINE_MAX);
}

function hasTooManyLines(value: string): boolean {
  return splitLines(value).length > LIST_MAX_LINES;
}

/** Voseo copy per the design's error/edge-case table. Both mutations funnel
 * through here — the subclasses each only ever come from one of the two
 * (ValidationError from create, NotFound/Conflict from arm), so checking
 * every branch on both is harmless. */
function cardErrorMessage(error: Error | null): string {
  if (error instanceof ValidationError) {
    return `El servidor rechazó la tarjeta: ${error.message}. Acortá el texto o repartilo en los campos.`;
  }
  if (error instanceof NotFoundError) {
    return "Esa tarjeta ya no existe. Actualizá la lista.";
  }
  if (error instanceof ConflictError) {
    return "Esa tarjeta ya no se puede armar (vencida o ya usada).";
  }
  const status = error instanceof ApiError ? error.status : 0;
  if (status === 401) return "No hay sesión de operador válida. Reabrí la app.";
  if (status === 429) return "Demasiadas operaciones seguidas. Esperá un minuto.";
  if (status === 503) return "La base de tarjetas no responde. Probá de nuevo en un rato.";
  return "No se pudo completar la acción.";
}

// Shared textarea chrome + growth policy (resize handle + inner scroll past
// the clamp). Two size ramps: narrative fields (summary/take) get a taller
// clamp than the compact one-per-line list fields.
const textareaBase =
  "w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-dim focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring resize-y overflow-y-auto";
const textareaNarrative = `${textareaBase} min-h-[96px] max-h-[240px]`;
const textareaCompact = `${textareaBase} min-h-[64px] max-h-[160px]`;

/**
 * "Tarjetas editoriales" — operator creates a structured editorial cue card
 * (topic/summary/take + optional one-per-line lists) and arms DRAFT cards.
 * Mirrors MemoriaImportSection 1:1 (design D3): single ConfirmFooter gate,
 * TanStack Query mutations, voseo per-status error copy. Structured fields
 * only — no raw-paste field — keeps the raw-dump rejection a UX property,
 * not just a 422 (design D1).
 */
export function EditorialCardsCard() {
  const [topic, setTopic] = useState("");
  const [summary, setSummary] = useState("");
  const [streamerTake, setStreamerTake] = useState("");
  const [counterpoints, setCounterpoints] = useState("");
  const [discussionHooks, setDiscussionHooks] = useState("");
  const [triggers, setTriggers] = useState("");
  const [singleUse, setSingleUse] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const createMutation = useCreateCardMutation();
  const armMutation = useArmCardMutation();
  const cardsQuery = useCardsQuery();

  const anyLongLine = hasLongLine(counterpoints) || hasLongLine(discussionHooks) || hasLongLine(triggers);
  const anyTooManyLines =
    hasTooManyLines(counterpoints) || hasTooManyLines(discussionHooks) || hasTooManyLines(triggers);

  const canSubmit = Boolean(topic.trim() && summary.trim() && streamerTake.trim()) && !createMutation.isPending;

  function resetForm() {
    setTopic("");
    setSummary("");
    setStreamerTake("");
    setCounterpoints("");
    setDiscussionHooks("");
    setTriggers("");
    setSingleUse(false);
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
        single_use: singleUse
      },
      { onSuccess: resetForm }
    );
  }

  // Design D4: GET returns every status, the UI filters to draft/armed —
  // terminal cards stay counts-only via editorial_cards_by_status in MemoryCard.
  const visibleCards = (cardsQuery.data?.cards ?? []).filter(
    (card) => card.status === "draft" || card.status === "armed"
  );

  return (
    <Card className="flex flex-col p-4">
      <div className="flex items-center justify-between gap-3 border-b border-border-soft pb-3">
        <h2 className="text-sm font-bold text-foreground">Tarjetas editoriales</h2>
      </div>

      <div className="flex flex-col gap-3.5 pt-3.5">
        <SubCollapsibleSection title="Crear tarjeta" persistKey="editorial-create">
          <div className="space-y-2">
            <label className="flex flex-col gap-1 text-[11px] font-semibold text-dim">
              Tema
              <Input
                aria-label="Tema"
                value={topic}
                maxLength={TOPIC_MAX}
                onChange={(event) => setTopic(event.target.value)}
              />
            </label>

            <label className="flex flex-col gap-1 text-[11px] font-semibold text-dim">
              Resumen
              <textarea
                aria-label="Resumen"
                value={summary}
                maxLength={SUMMARY_MAX}
                onChange={(event) => setSummary(event.target.value)}
                rows={3}
                className={textareaNarrative}
              />
            </label>

            <label className="flex flex-col gap-1 text-[11px] font-semibold text-dim">
              Postura del streamer
              <textarea
                aria-label="Postura del streamer"
                value={streamerTake}
                maxLength={TAKE_MAX}
                onChange={(event) => setStreamerTake(event.target.value)}
                rows={3}
                className={textareaNarrative}
              />
            </label>

            <label className="flex flex-col gap-1 text-[11px] font-semibold text-dim">
              Contrapuntos (uno por línea)
              <textarea
                aria-label="Contrapuntos (uno por línea)"
                value={counterpoints}
                onChange={(event) => setCounterpoints(event.target.value)}
                rows={2}
                className={textareaCompact}
              />
            </label>

            <label className="flex flex-col gap-1 text-[11px] font-semibold text-dim">
              Ganchos de discusión (uno por línea)
              <textarea
                aria-label="Ganchos de discusión (uno por línea)"
                value={discussionHooks}
                onChange={(event) => setDiscussionHooks(event.target.value)}
                rows={2}
                className={textareaCompact}
              />
            </label>

            <label className="flex flex-col gap-1 text-[11px] font-semibold text-dim">
              Disparadores (uno por línea)
              <textarea
                aria-label="Disparadores (uno por línea)"
                value={triggers}
                onChange={(event) => setTriggers(event.target.value)}
                rows={2}
                className={textareaCompact}
              />
            </label>

            <label className="flex items-center gap-2 text-[11px] font-semibold text-dim">
              <input
                type="checkbox"
                aria-label="De un solo uso"
                checked={singleUse}
                onChange={(event) => setSingleUse(event.target.checked)}
              />
              De un solo uso
            </label>

            {anyLongLine && (
              <p className="text-xs leading-relaxed text-warn">Cada línea puede tener hasta 240 caracteres.</p>
            )}
            {anyTooManyLines && (
              <p className="text-xs leading-relaxed text-warn">Solo se guardan las primeras 8 líneas.</p>
            )}

            {createMutation.isError && <Alert tone="danger">{cardErrorMessage(createMutation.error)}</Alert>}
            {createMutation.data && (
              <p className="text-xs leading-relaxed text-foreground">
                {createMutation.data.demoted
                  ? "Guardaste cambios: la tarjeta volvió a borrador. Armala de nuevo cuando quieras."
                  : "Tarjeta guardada como borrador. Armala cuando quieras."}
              </p>
            )}

            {confirming ? (
              <ConfirmFooter
                active
                tone="neutral"
                stages={[{ message: `Vas a crear la tarjeta "${topic.trim()}".`, advanceLabel: "Confirmar" }]}
                onConfirm={handleConfirm}
                onCancel={() => setConfirming(false)}
                busy={createMutation.isPending}
              />
            ) : (
              <Button type="button" variant="outline" disabled={!canSubmit} onClick={openConfirm}>
                Guardar tarjeta
              </Button>
            )}
          </div>
        </SubCollapsibleSection>

        <SubCollapsibleSection title="Tarjetas · borrador y armadas" persistKey="editorial-list">
          <div className="space-y-2">
            {cardsQuery.isError && (
              <p role="alert" className="text-xs leading-relaxed text-danger">
                No se pudo leer la lista de tarjetas.
              </p>
            )}
            {armMutation.isError && <Alert tone="danger">{cardErrorMessage(armMutation.error)}</Alert>}
            {armMutation.data && (
              <p className="text-xs leading-relaxed text-foreground">
                Tarjeta armada. Kira puede usarla cuando el tema salga.
              </p>
            )}

            {visibleCards.length === 0 ? (
              <p className="text-xs text-dim">No hay tarjetas en borrador o armadas todavía.</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {visibleCards.map((card) => (
                  <li
                    key={card.id}
                    className="grid grid-cols-[1fr_auto_auto] items-center gap-2 rounded-md border border-border bg-surface-2 p-3"
                  >
                    <span className="text-sm text-foreground">{card.topic}</span>
                    <span className="flex items-center gap-1.5">
                      <Badge tone={card.status === "armed" ? "info" : "neutral"}>
                        {card.status === "armed" ? "armada" : "borrador"}
                      </Badge>
                      {card.single_use && <Badge tone="warn">de un solo uso</Badge>}
                    </span>
                    {card.status === "draft" && (
                      <Button
                        type="button"
                        variant="ghost"
                        disabled={armMutation.isPending}
                        onClick={() => armMutation.mutate(card.id)}
                      >
                        Armar
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </SubCollapsibleSection>
      </div>
    </Card>
  );
}
