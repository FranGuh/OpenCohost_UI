import { useEffect, useState, type ChangeEvent } from "react";
import { cn } from "../../lib/cn.js";
import { Card } from "../../ui/Card.js";
import { Badge } from "../../ui/Badge.js";
import { Button } from "../../ui/Button.js";
import { Dialog } from "../../ui/Dialog.js";
import { Input } from "../../ui/Input.js";
import { Select } from "../../ui/Select.js";
import { Alert } from "../../ui/Alert.js";
import { ConfirmFooter } from "../../ui/ConfirmFooter.js";
import { Segmented } from "../../ui/Segmented.js";
import { SubCollapsibleSection, useCollapsible } from "../../ui/Collapsible.js";
import { ApiError } from "../../api/client.js";
import type { MemoriaListItem } from "../../api/client.js";
import {
  useMemoriaDeleteMutation,
  useMemoriaFlagsMutation,
  useMemoriaImportMutation,
  useMemoriaListQuery,
  useMemoriaPurgeMutation,
  useMemoriaRowQuery,
  useMemoriaStatsQuery,
  useMemoriaUpdateMutation
} from "../../api/memoria.js";
import type { MemoriaImportResponse } from "../../api/memoria.js";
import { useEngineCommand } from "../../api/engineCommand.js";
import { useStatusQuery } from "../../api/status.js";
import { t, useT, type TKey } from "../../i18n/t.js";

// R8 (privacy): this card renders counts ONLY, never raw chat/persona content.
function countRows(stats: {
  session_turns: number;
  digest_entries: number;
  saved_memorias: number;
  pinned: number;
  editorial_cards_by_status: Record<string, number>;
}): Array<[string, number]> {
  return [
    [t("controles.memory.counts.turns"), stats.session_turns],
    [t("controles.memory.counts.digest"), stats.digest_entries],
    [t("controles.memory.counts.saved"), stats.saved_memorias],
    [t("controles.memory.counts.pinned"), stats.pinned],
    ...Object.entries(stats.editorial_cards_by_status).map(
      ([status, count]) =>
        [t("controles.memory.counts.editorialCard", { status }), count] as [string, number]
    )
  ];
}

/**
 * One memoria card in the detail list (WU2 redesign, 2026-07-05). Mirrors the
 * ConversationPanel chat-card tokens (rounded-md border border-border
 * bg-surface-2) so the detail reads as the same system as the transcript.
 *
 * Content is fetched on-demand via useMemoriaRowQuery's lazy `enabled: false`
 * + manual `refetch()`, NEVER preloaded alongside the list (R8: memoria
 * content is Kira's curated/derived memory, still never raw viewer chat). The
 * only two paths that trigger the fetch are explicit operator clicks: "Ver
 * memoria" (read, in a Dialog — refetched fresh on every open, never just
 * served from cache) and "Editar" (prefill the edit form).
 *
 * Actions are wired straight to the memoria mutations — flags (pin/private/
 * inactive) invalidate the list+stats, delete is two-step confirmed, and edit
 * writes title+content back through useMemoriaUpdateMutation.
 */
function MemoriaRow({ item, profileId }: { item: MemoriaListItem; profileId: string }) {
  const t = useT();
  const [viewing, setViewing] = useState(false);
  const [editing, setEditing] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [editTitle, setEditTitle] = useState(item.title);
  const [editContent, setEditContent] = useState("");
  const rowQuery = useMemoriaRowQuery(profileId, item.id);
  const flagsMutation = useMemoriaFlagsMutation(profileId);
  const updateMutation = useMemoriaUpdateMutation(profileId);
  const deleteMutation = useMemoriaDeleteMutation(profileId);

  // Seed the edit form's content once the on-demand fetch lands. Only runs
  // while editing, and rowQuery.data changes only on a refetch (which nothing
  // triggers mid-edit), so this never clobbers the operator's typing.
  // ponytail: no separate "seeded" ref — the editing guard + stable data is enough.
  useEffect(() => {
    if (editing && rowQuery.data) setEditContent(rowQuery.data.content);
  }, [editing, rowQuery.data]);

  function openView() {
    setViewing(true);
    void rowQuery.refetch();
  }

  function startEdit() {
    setEditTitle(item.title);
    setEditContent(rowQuery.data?.content ?? "");
    setEditing(true);
    // R8: explicit operator action — fetch content to edit it (title alone is
    // in the list, content is not) unless it's already cached.
    if (!rowQuery.data) void rowQuery.refetch();
  }

  const busy = flagsMutation.isPending || updateMutation.isPending || deleteMutation.isPending;

  return (
    <li className="flex flex-col gap-2 rounded-md border border-border bg-surface-2 p-3">
      <div className="grid grid-cols-[1fr_auto] items-start gap-2">
        <span className="text-sm font-semibold text-foreground">{item.title}</span>
        <span className="mono whitespace-nowrap text-[11px] text-dim">{item.updated_at}</span>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {item.pinned && <Badge tone="info">{t("controles.memory.row.badge.pinned")}</Badge>}
        {item.private && <Badge tone="neutral">{t("controles.memory.row.badge.private")}</Badge>}
        {item.inactive && <Badge tone="warn">{t("controles.memory.row.badge.inactive")}</Badge>}
        {item.imported && <Badge tone="neutral">{t("controles.memory.row.badge.imported")}</Badge>}
        {/* memoria_draft_visibility_20260725: an auto-captured row with no
            operator confirmation — display-only, mirrors EditorialCardsCard's
            existing neutral "borrador" badge (same word, same tone). */}
        {item.draft && <Badge tone="neutral">{t("controles.memory.row.badge.draft")}</Badge>}
        <Button type="button" variant="ghost" onClick={openView}>
          {t("controles.memory.row.view.action")}
        </Button>
      </div>

      <Dialog open={viewing} onClose={() => setViewing(false)} ariaLabelledBy={`memoria-row-title-${item.id}`}>
        <Card className="flex min-h-0 w-full flex-col overflow-y-auto p-4">
          <div className="flex items-center justify-between gap-3 border-b border-border-soft pb-3">
            <h2 id={`memoria-row-title-${item.id}`} className="text-sm font-bold text-foreground">
              {item.title}
            </h2>
            <button
              type="button"
              aria-label={t("controles.memory.row.hide.action")}
              onClick={() => setViewing(false)}
              className="flex h-7 w-7 items-center justify-center rounded-full text-muted-foreground transition-colors duration-fast ease-io hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              ✕
            </button>
          </div>
          <div className="pt-3.5">
            {rowQuery.isPending && <p className="text-xs text-dim">{t("controles.memory.row.view.loading")}</p>}
            {rowQuery.isError && (
              <p role="alert" className="text-xs leading-relaxed text-danger">
                {rowQuery.error?.message ?? t("controles.memory.row.load.error")}
              </p>
            )}
            {rowQuery.data && (
              <p className="whitespace-pre-wrap text-xs leading-relaxed text-foreground">{rowQuery.data.content}</p>
            )}
          </div>
        </Card>
      </Dialog>

      {(flagsMutation.isError || deleteMutation.isError || updateMutation.isError) && (
        <p role="alert" className="text-xs leading-relaxed text-danger">
          {flagsMutation.error?.message ??
            deleteMutation.error?.message ??
            updateMutation.error?.message ??
            t("controles.memory.row.action.error")}
        </p>
      )}

      {editing ? (
        <div className="flex flex-col gap-2 border-t border-border-soft pt-2">
          <label className="flex flex-col gap-1 text-[11px] font-semibold text-dim">
            {t("controles.memory.row.edit.titleLabel")}
            <Input
              aria-label={t("controles.memory.row.edit.title.aria")}
              value={editTitle}
              onChange={(event) => setEditTitle(event.target.value)}
            />
          </label>
          <label className="flex flex-col gap-1 text-[11px] font-semibold text-dim">
            {t("controles.memory.row.edit.contentLabel")}
            {rowQuery.isFetching && !rowQuery.data ? (
              <p className="text-xs text-dim">{t("controles.memory.row.edit.loading")}</p>
            ) : (
              <textarea
                aria-label={t("controles.memory.row.edit.content.aria")}
                value={editContent}
                onChange={(event) => setEditContent(event.target.value)}
                rows={4}
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-dim focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring resize-y overflow-y-auto min-h-[96px] max-h-[240px]"
              />
            )}
          </label>
          <div className="flex gap-2">
            <Button type="button" variant="ghost" onClick={() => setEditing(false)}>
              {t("controles.memory.row.edit.cancel.action")}
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={busy || !editTitle.trim() || !editContent.trim()}
              onClick={() => {
                updateMutation.mutate(
                  { id: item.id, title: editTitle, content: editContent },
                  { onSuccess: () => setEditing(false) }
                );
              }}
            >
              {t("controles.memory.row.edit.save.action")}
            </Button>
          </div>
        </div>
      ) : (
        <>
          {confirmingDelete ? (
            // Single-row delete — Alert-style danger message + mutating footer
            // (no ack gate: one row is low blast-radius; the ack ladder is
            // reserved for the full-wipe actions clear_history / purge).
            <div className="border-t border-border-soft pt-2">
              <ConfirmFooter
                active
                stages={[
                  {
                    message: t("controles.memory.row.delete.confirm"),
                    advanceLabel: t("controles.memory.row.delete.action")
                  }
                ]}
                onConfirm={() => {
                  setConfirmingDelete(false);
                  deleteMutation.mutate(item.id);
                }}
                onCancel={() => setConfirmingDelete(false)}
                busy={deleteMutation.isPending}
              />
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-2 border-t border-border-soft pt-2">
              <Button
                type="button"
                variant="ghost"
                disabled={busy}
                onClick={() => flagsMutation.mutate({ id: item.id, pinned: !item.pinned })}
              >
                {item.pinned ? t("controles.memory.row.unpin.action") : t("controles.memory.row.pin.action")}
              </Button>
              <Button
                type="button"
                variant="ghost"
                disabled={busy}
                onClick={() => flagsMutation.mutate({ id: item.id, private: !item.private })}
              >
                {item.private
                  ? t("controles.memory.row.makePublic.action")
                  : t("controles.memory.row.makePrivate.action")}
              </Button>
              <Button
                type="button"
                variant="ghost"
                disabled={busy}
                onClick={() => flagsMutation.mutate({ id: item.id, inactive: !item.inactive })}
              >
                {item.inactive
                  ? t("controles.memory.row.reactivate.action")
                  : t("controles.memory.row.deactivate.action")}
              </Button>
              <Button type="button" variant="ghost" disabled={busy} onClick={startEdit}>
                {t("controles.memory.row.edit.action")}
              </Button>
              <Button type="button" variant="ghost" disabled={busy} onClick={() => setConfirmingDelete(true)}>
                {t("controles.memory.row.delete.trigger.action")}
              </Button>
            </div>
          )}
        </>
      )}
    </li>
  );
}

// Fixed source set for the import provenance label. "Otro" switches to a free
// Input (client-cap 40 to match the server's _MEMORIA_IMPORT_LABEL_MAX_LENGTH).
// Gemini/ChatGPT/Obsidian are proper nouns (unchanged); "Otro" is real copy,
// resolved to a key so it hot-swaps — see buildImportSources below.
const IMPORT_SOURCE_VALUES = ["Gemini", "ChatGPT", "Obsidian", "Otro"] as const;
function buildImportSources(t: ReturnType<typeof useT>) {
  return IMPORT_SOURCE_VALUES.map((value) => ({
    value,
    label: value === "Otro" ? t("controles.memory.import.source.other") : value
  }));
}
const IMPORT_LABEL_MAX = 40;
// Mirrors settings.MEMORIAS_IMPORT_MAX_BYTES — a client-side courtesy hint; the
// backend still 422s an oversize body, this just warns before the round-trip.
const IMPORT_MAX_BYTES = 65_536;

/** Voseo, honest result line built from the REAL counts — skipped_cap/failed
 * only appear when nonzero so a clean import stays terse. */
function importResultLine(result: MemoriaImportResponse): string {
  const parts = [
    result.imported === 1
      ? t("controles.memory.import.summary.one")
      : t("controles.memory.import.summary.many", { n: result.imported }),
    `${result.skipped_duplicates} ${
      result.skipped_duplicates === 1
        ? t("controles.memory.import.duplicates.one")
        : t("controles.memory.import.duplicates.many")
    }`,
    `${result.skipped_too_short} ${
      result.skipped_too_short === 1
        ? t("controles.memory.import.tooShort.one")
        : t("controles.memory.import.tooShort.many")
    }`
  ];
  if (result.skipped_cap > 0) parts.push(t("controles.memory.import.skippedCap", { n: result.skipped_cap }));
  if (result.failed > 0) parts.push(t("controles.memory.import.failed", { n: result.failed }));
  return `${parts.join(" · ")}.`;
}

/** Kind voseo copy per error status — 422 groups the boundary refusals
 * (empty/oversize/too-many/label/cap) into one honest sentence; 503 is the
 * store being down. */
function importErrorMessage(error: Error | null): string {
  const status = error instanceof ApiError ? error.status : 0;
  if (status === 0) {
    // fetch itself rejected (no HTTP status reached) — the backend is down or
    // mid-restart, not a validation problem.
    return t("controles.memory.import.error.noBackend");
  }
  if (status === 404) {
    // Route missing on the running backend (older build / route not wired).
    return t("controles.memory.import.error.notFound");
  }
  if (status === 422) {
    return t("controles.memory.import.error.validation");
  }
  if (status === 503) {
    return t("controles.memory.import.error.unavailable");
  }
  return t("controles.memory.import.error.generic");
}

/**
 * "Importar memorias" section — brings an external-AI export (Gemini/ChatGPT/
 * Obsidian/free label) into the active profile's store via POST
 * /api/memoria/import. Paste OR a .md/.txt file feed the SAME content field
 * (FileReader). D7: the send is ALWAYS gated behind a single ConfirmFooter
 * stage (no client-side item parser). The result line reports the real
 * server counts; errors surface honestly instead of a fake success.
 */
function MemoriaImportSection({ profileId }: { profileId: string }) {
  const t = useT();
  const importSources = buildImportSources(t);
  const [source, setSource] = useState<string>("Gemini");
  const [customLabel, setCustomLabel] = useState("");
  const [content, setContent] = useState("");
  const [confirming, setConfirming] = useState(false);
  // Holds the key, not the resolved message — see fileError's render site.
  const [fileError, setFileError] = useState<TKey | null>(null);
  const importMutation = useMemoriaImportMutation(profileId);

  // WIRE value sent as `source_label` below — "Otro" here is a literal
  // fallback the backend stores verbatim, never translated copy.
  const effectiveLabel = source === "Otro" ? customLabel.trim().slice(0, IMPORT_LABEL_MAX) || "Otro" : source;
  // DISPLAY value for the confirm message: when the source is "Otro" and no
  // custom label was typed, effectiveLabel falls back to the raw Spanish
  // literal "Otro" — read it through the same key the source Select already
  // uses for that option's label so the confirm sentence reads in the current
  // locale instead of always Spanish.
  const displayLabel =
    source === "Otro" && !customLabel.trim() ? t("controles.memory.import.source.other") : effectiveLabel;
  const oversize = new Blob([content]).size > IMPORT_MAX_BYTES;
  // An oversize body (pasted OR read from a file) can never succeed — the
  // server 422s it — so it must not be submittable either.
  const canSubmit =
    Boolean(profileId) && content.trim().length > 0 && !oversize && !importMutation.isPending;

  function handleFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    // R1: reject an oversize file BEFORE reading it — never load a body the
    // server is guaranteed to refuse (and don't set content from it).
    if (file.size > IMPORT_MAX_BYTES) {
      setFileError("controles.memory.import.file.tooLarge.error");
      return;
    }
    setFileError(null);
    const reader = new FileReader();
    reader.onload = () => setContent(typeof reader.result === "string" ? reader.result : "");
    reader.onerror = () => setFileError("controles.memory.import.file.read.error");
    reader.readAsText(file);
  }

  function handleConfirm() {
    setConfirming(false);
    // Clear the textarea on success so the same body can't be accidentally
    // resubmitted (dedup protects the data, but the UX shouldn't invite it).
    importMutation.mutate({ source_label: effectiveLabel, content }, { onSuccess: () => setContent("") });
  }

  function openConfirm() {
    // Starting a fresh import — drop any prior result/error first so a stale
    // count line never lingers into this import's pending window.
    importMutation.reset();
    setConfirming(true);
  }

  return (
    <section aria-labelledby="memory-import-label" className="space-y-2">
      <span id="memory-import-label" className="text-[11px] font-semibold uppercase tracking-[0.09em] text-dim">
        {t("controles.memory.import.eyebrow")}
      </span>
      <p className="text-[11px] leading-relaxed text-dim">{t("controles.memory.import.description")}</p>

      {!profileId ? (
        // Sibling pattern to the row list's null-profile branch: without an
        // active profile there is no uuid to import into, so prompt for one
        // instead of leaving a silently disabled button.
        <p className="text-xs text-dim">{t("controles.memory.import.noProfile")}</p>
      ) : (
        <>
          <label className="flex flex-col gap-1 text-[11px] font-semibold text-dim">
            {t("controles.memory.import.source.label")}
            <Select
              options={importSources}
              value={source}
              onChange={setSource}
              aria-label={t("controles.memory.import.source.aria")}
            />
          </label>

          {source === "Otro" && (
            <label className="flex flex-col gap-1 text-[11px] font-semibold text-dim">
              {t("controles.memory.import.customLabel")}
              <Input
                aria-label={t("controles.memory.import.customLabel")}
                value={customLabel}
                maxLength={IMPORT_LABEL_MAX}
                placeholder={t("controles.memory.import.customLabel.placeholder")}
                onChange={(event) => setCustomLabel(event.target.value)}
              />
            </label>
          )}

          <label className="flex flex-col gap-1 text-[11px] font-semibold text-dim">
            {t("controles.memory.import.file.label")}
            <input
              type="file"
              accept=".md,.txt"
              aria-label={t("controles.memory.import.file.aria")}
              onChange={handleFile}
              className="text-xs text-foreground file:mr-3 file:rounded-md file:border file:border-border file:bg-surface-2 file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-foreground"
            />
          </label>

          {fileError && <p className="text-xs leading-relaxed text-warn">{t(fileError)}</p>}

          <label className="flex flex-col gap-1 text-[11px] font-semibold text-dim">
            {t("controles.memory.import.paste.label")}
            <textarea
              aria-label={t("controles.memory.import.paste.aria")}
              value={content}
              onChange={(event) => setContent(event.target.value)}
              rows={4}
              placeholder={t("controles.memory.import.paste.placeholder")}
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-dim focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring resize-y overflow-y-auto min-h-[96px] max-h-[240px]"
            />
          </label>

          {oversize && (
            <p className="text-xs leading-relaxed text-warn">{t("controles.memory.import.oversize.notice")}</p>
          )}

          {importMutation.isError && <Alert tone="danger">{importErrorMessage(importMutation.error)}</Alert>}

          {importMutation.data && (
            <p className="text-xs leading-relaxed text-foreground">{importResultLine(importMutation.data)}</p>
          )}

          {importMutation.isPending ? (
            // Explicit working state — distinct from the incomplete-form disabled
            // button, so the operator can tell "importing" from "stuck".
            <p role="status" className="text-xs leading-relaxed text-dim">
              {t("controles.memory.import.pending.status")}
            </p>
          ) : confirming ? (
            <ConfirmFooter
              active
              tone="neutral"
              stages={[
                {
                  message: t("controles.memory.import.confirm", { label: displayLabel }),
                  advanceLabel: t("controles.memory.import.confirm.action")
                }
              ]}
              onConfirm={handleConfirm}
              onCancel={() => setConfirming(false)}
              busy={importMutation.isPending}
            />
          ) : (
            <Button type="button" variant="outline" disabled={!canSubmit} onClick={openConfirm}>
              {t("controles.memory.import.action")}
            </Button>
          )}
        </>
      )}
    </section>
  );
}

// Ticket C: client-side provenance filter for the row list. `imported` is the
// only provenance signal MemoriaListItem actually carries (WU4) — "native"
// is just its honest complement (not imported). Per-source origin
// (Gemini/ChatGPT/Obsidian) is NOT built here: the list projection only
// exposes the imported boolean, never which source label an imported row
// came from, so a per-source chip would have to fake data the row doesn't
// have.
type MemoriaTierFilter = "all" | "imported" | "native";

function buildTierOptions(t: ReturnType<typeof useT>) {
  return [
    { value: "all", label: t("controles.memory.list.filter.all") },
    { value: "imported", label: t("controles.memory.list.filter.imported") },
    { value: "native", label: t("controles.memory.list.filter.native") }
  ] as const;
}

function filterByTier(items: MemoriaListItem[], tier: MemoriaTierFilter): MemoriaListItem[] {
  if (tier === "all") return items;
  return items.filter((item) => (tier === "imported" ? item.imported : !item.imported));
}

/**
 * Memoria card — counts inspector wired to GET /api/memoria/stats.
 * "Limpiar memoria" is destructive and irreversible, so it keeps a two-step
 * confirm (same pattern as ProfileEditor's delete-profile confirm) before
 * dispatching `clear_history` via useEngineCommand — no confirm dialog
 * component, just a local confirm/cancel row.
 */
export function MemoryCard() {
  const t = useT();
  const tierOptions = buildTierOptions(t);
  // Memoria rows are stored keyed by the profile's stable uuid, not its
  // display name — active_profile is a NAME (StatusRail label), so it must
  // never be used here. `active_profile_id` is null until the engine seeds it
  // at boot (FIX-A) or applies a switch; on an older backend that never seeds,
  // the empty-string fallback degrades gracefully via the `enabled` /
  // disabled-button guards AND the explicit null-profile branch below.
  const profileId = useStatusQuery().data?.active_profile_id ?? "";
  // Per-profile stats (FIX-A): the headline count uses the same profile as the
  // row list, so "Memorias guardadas: N" and the list agree instead of showing
  // a global total next to a per-profile (often empty) list.
  const { data, isError: statsError } = useMemoriaStatsQuery(profileId);
  const clearCommand = useEngineCommand<void>();
  const [confirming, setConfirming] = useState(false);

  const { data: listData, isError: listError } = useMemoriaListQuery(profileId);
  const purgeMutation = useMemoriaPurgeMutation(profileId);
  const [confirmingPurge, setConfirmingPurge] = useState(false);
  // Shared collapse primitive (persists under oc-collapse-memoria-list) replaces
  // the former bespoke listOpen useState — the detail list's open state now
  // survives panel navigation like every other section.
  const [listOpen, toggleList] = useCollapsible(false, "memoria-list");
  const [tierFilter, setTierFilter] = useState<MemoriaTierFilter>("all");
  const filteredItems = listData ? filterByTier(listData.items, tierFilter) : [];

  function handleConfirmClear() {
    setConfirming(false);
    void clearCommand.run("clear_history");
  }

  function handleConfirmPurge() {
    setConfirmingPurge(false);
    purgeMutation.mutate();
  }

  return (
    <Card className="flex flex-col p-4">
      <div className="flex items-center justify-between gap-3 border-b border-border-soft pb-3">
        <h2 className="text-sm font-bold text-foreground">{t("controles.memory.card.title")}</h2>
        {clearCommand.pending && <Badge tone="info">{t("controles.memory.card.pending")}</Badge>}
      </div>

      <div className="flex flex-col gap-3.5 pt-3.5">
        {/* Dashboard reads first — moved above the danger zone/import sections
            (it used to sit between them, a strange place for a summary). No
            inner scroll box: this tile grid wraps in normal flow like every
            other card content. */}
        <section aria-labelledby="memory-counts-label" className="space-y-2">
          <span id="memory-counts-label" className="text-[11px] font-semibold uppercase tracking-[0.09em] text-dim">
            {t("controles.memory.counts.eyebrow")}
          </span>
          {statsError && (
            <p role="alert" className="text-xs leading-relaxed text-danger">
              {t("controles.memory.counts.error")}
            </p>
          )}
          {data && (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(104px,1fr))] gap-2">
              {countRows(data).map(([label, count]) => (
                <div key={label} className="flex flex-col gap-0.5 rounded-md border border-border-soft bg-surface-2 px-3 py-2">
                  <span className="mono text-xl font-bold tabular-nums text-foreground">{count}</span>
                  <span className="text-[11px] leading-snug text-dim">{label}</span>
                </div>
              ))}
            </div>
          )}
        </section>

        {clearCommand.isError && (
          <p role="alert" className="text-xs leading-relaxed text-danger">
            {clearCommand.error?.message ?? t("controles.memory.clear.error")}
          </p>
        )}

        <SubCollapsibleSection title={t("controles.memory.actions.eyebrow")} persistKey="memoria-actions">
          {confirming ? (
            // Severe (wipes ALL conversation history, irreversible) — so it gets
            // the same ack-gated single-stage ConfirmFooter as the profile delete.
            <ConfirmFooter
              active
              stages={[
                {
                  message: t("controles.memory.clear.confirm"),
                  acknowledgment: t("controles.memory.clear.ack"),
                  advanceLabel: t("controles.memory.clear.confirm.action")
                }
              ]}
              onConfirm={handleConfirmClear}
              onCancel={() => setConfirming(false)}
              busy={clearCommand.pending}
            />
          ) : (
            <div className="grid grid-cols-[1fr_auto] items-center gap-3">
              <p className="text-xs leading-relaxed text-warn">{t("controles.memory.clear.warning")}</p>
              <Button type="button" variant="outline" disabled={clearCommand.pending} onClick={() => setConfirming(true)}>
                {t("controles.memory.clear.trigger.action")}
              </Button>
            </div>
          )}
        </SubCollapsibleSection>

        <MemoriaImportSection profileId={profileId} />

        <section aria-labelledby="memory-list-label" className="space-y-2">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-baseline gap-2">
              <span id="memory-list-label" className="text-[11px] font-semibold uppercase tracking-[0.09em] text-dim">
                {t("controles.memory.list.eyebrow")}
              </span>
              {listData && (
                <span className="tabular-nums text-[11px] text-dim">
                  {listData.items.length}{" "}
                  {listData.items.length === 1
                    ? t("controles.memory.list.count.one")
                    : t("controles.memory.list.count.many")}
                </span>
              )}
            </div>
            <Button
              type="button"
              variant="ghost"
              aria-expanded={listOpen}
              onClick={toggleList}
            >
              {listOpen ? t("controles.memory.list.toggle.hide") : t("controles.memory.list.toggle.show")}
              <span
                aria-hidden="true"
                className={cn("text-xs text-dim transition-transform duration-base ease-io", !listOpen && "-rotate-90")}
              >
                ▾
              </span>
            </Button>
          </div>

          {listOpen && (
            <>
              {!profileId ? (
                // Explicit null-profile branch: without an active profile there
                // is no uuid to scope the list to, so explain that instead of
                // rendering nothing (the `listData &&` blocks would otherwise
                // both be skipped, leaving a silent blank). Covers the
                // old-backend/new-frontend skew where active_profile_id is null.
                <p className="text-xs text-dim">{t("controles.memory.list.noProfile")}</p>
              ) : (
                <>
                  {listError && (
                    <p role="alert" className="text-xs leading-relaxed text-danger">
                      {t("controles.memory.list.error")}
                    </p>
                  )}
                  {listData && listData.items.length === 0 && (
                    <div className="flex flex-col items-center gap-1 rounded-md border border-dashed border-border-soft px-4 py-6 text-center">
                      <span aria-hidden="true" className="text-lg">
                        🧠
                      </span>
                      <p className="text-xs text-foreground">{t("controles.memory.list.empty.title")}</p>
                      <p className="text-[11px] leading-relaxed text-dim">{t("controles.memory.list.empty.hint")}</p>
                    </div>
                  )}
                  {listData && listData.items.length > 0 && (
                    <>
                      <Segmented
                        options={tierOptions}
                        value={tierFilter}
                        onChange={setTierFilter}
                        ariaLabel={t("controles.memory.list.filter.aria")}
                      />
                      {filteredItems.length === 0 ? (
                        <p className="text-xs text-dim">{t("controles.memory.list.filter.empty")}</p>
                      ) : (
                        // No inner max-h/overflow box: this card now lives in its own
                        // full-width Memoria section, where the panel scroll every
                        // sibling section already relies on can hold the whole list
                        // (docs/UI_CONSTRAINTS_LEARNED.md §6) instead of the card
                        // boxing itself. The list still opens behind a collapse
                        // (default closed), so a 111-memory catalog only lands in page
                        // flow when the operator asks for it.
                        <ul className="flex flex-col gap-2">
                          {filteredItems.map((item) => (
                            <MemoriaRow key={item.id} item={item} profileId={profileId} />
                          ))}
                        </ul>
                      )}
                    </>
                  )}
                </>
              )}

              {purgeMutation.isError && (
                <p role="alert" className="text-xs leading-relaxed text-danger">
                  {t("controles.memory.purge.error")}
                </p>
              )}
              {confirmingPurge ? (
                // Three-stage gate — this wipes every saved memory, so it needs
                // more friction than a single confirm click. Stage 3 (last) is
                // the only one that fires the purge.
                <ConfirmFooter
                  active
                  stages={[
                    {
                      message: t("controles.memory.purge.stage1"),
                      advanceLabel: t("controles.memory.purge.stage1.action")
                    },
                    {
                      message: t("controles.memory.purge.stage2"),
                      acknowledgment: t("controles.memory.purge.stage2.ack"),
                      advanceLabel: t("controles.memory.purge.stage2.action")
                    },
                    {
                      message: t("controles.memory.purge.stage3"),
                      advanceLabel: t("controles.memory.purge.stage3.action")
                    }
                  ]}
                  onConfirm={handleConfirmPurge}
                  onCancel={() => setConfirmingPurge(false)}
                  busy={purgeMutation.isPending}
                />
              ) : (
                <Button
                  type="button"
                  variant="outline"
                  disabled={purgeMutation.isPending || !profileId}
                  onClick={() => setConfirmingPurge(true)}
                >
                  {t("controles.memory.purge.trigger.action")}
                </Button>
              )}
            </>
          )}
        </section>
      </div>
    </Card>
  );
}
