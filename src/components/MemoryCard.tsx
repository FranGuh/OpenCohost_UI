import { useEffect, useState } from "react";
import { Card } from "./ui/Card.js";
import { Badge } from "./ui/Badge.js";
import { Button } from "./ui/Button.js";
import { Input } from "./ui/Input.js";
import { ConfirmFooter } from "./ui/ConfirmFooter.js";
import type { MemoriaListItem } from "../api/client.js";
import {
  useMemoriaDeleteMutation,
  useMemoriaFlagsMutation,
  useMemoriaListQuery,
  useMemoriaPurgeMutation,
  useMemoriaRowQuery,
  useMemoriaStatsQuery,
  useMemoriaUpdateMutation
} from "../api/memoria.js";
import { useEngineCommand } from "../api/engineCommand.js";
import { useStatusQuery } from "../api/status.js";

// R8 (privacy): this card renders counts ONLY, never raw chat/persona content.
function countRows(stats: {
  session_turns: number;
  digest_entries: number;
  saved_memorias: number;
  pinned: number;
  editorial_cards_by_status: Record<string, number>;
}): Array<[string, number]> {
  return [
    ["Turnos de sesión", stats.session_turns],
    ["Entradas de digest", stats.digest_entries],
    ["Memorias guardadas", stats.saved_memorias],
    ["Fijadas", stats.pinned],
    ...Object.entries(stats.editorial_cards_by_status).map(
      ([status, count]) => [`Tarjetas editoriales · ${status}`, count] as [string, number]
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
 * memoria" (read) and "Editar" (prefill the edit form).
 *
 * Actions are wired straight to the memoria mutations — flags (pin/private/
 * inactive) invalidate the list+stats, delete is two-step confirmed, and edit
 * writes title+content back through useMemoriaUpdateMutation.
 */
function MemoriaRow({ item, profileId }: { item: MemoriaListItem; profileId: string }) {
  const [expanded, setExpanded] = useState(false);
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

  function toggle() {
    if (expanded) {
      setExpanded(false);
      return;
    }
    setExpanded(true);
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
        {item.pinned && <Badge tone="info">fijada</Badge>}
        {item.private && <Badge tone="neutral">privada</Badge>}
        {item.inactive && <Badge tone="warn">inactiva</Badge>}
        <Button type="button" variant="ghost" onClick={toggle}>
          {expanded ? "Ocultar memoria" : "Ver memoria"}
        </Button>
      </div>

      {(flagsMutation.isError || deleteMutation.isError || updateMutation.isError) && (
        <p role="alert" className="text-xs leading-relaxed text-danger">
          {flagsMutation.error?.message ??
            deleteMutation.error?.message ??
            updateMutation.error?.message ??
            "No se pudo aplicar la acción."}
        </p>
      )}

      {editing ? (
        <div className="flex flex-col gap-2 border-t border-border-soft pt-2">
          <label className="flex flex-col gap-1 text-[11px] font-semibold text-dim">
            Título
            <Input
              aria-label="Título de la memoria"
              value={editTitle}
              onChange={(event) => setEditTitle(event.target.value)}
            />
          </label>
          <label className="flex flex-col gap-1 text-[11px] font-semibold text-dim">
            Contenido
            {rowQuery.isFetching && !rowQuery.data ? (
              <p className="text-xs text-dim">Cargando…</p>
            ) : (
              <textarea
                aria-label="Contenido de la memoria"
                value={editContent}
                onChange={(event) => setEditContent(event.target.value)}
                rows={4}
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-dim focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              />
            )}
          </label>
          <div className="flex gap-2">
            <Button type="button" variant="ghost" onClick={() => setEditing(false)}>
              Cancelar
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
              Guardar
            </Button>
          </div>
        </div>
      ) : (
        <>
          {expanded && (
            <div className="border-t border-border-soft pt-2">
              {rowQuery.isPending && <p className="text-xs text-dim">Cargando…</p>}
              {rowQuery.isError && (
                <p role="alert" className="text-xs leading-relaxed text-danger">
                  {rowQuery.error?.message ?? "No se pudo cargar la memoria."}
                </p>
              )}
              {rowQuery.data && (
                <p className="whitespace-pre-wrap text-xs leading-relaxed text-foreground">{rowQuery.data.content}</p>
              )}
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2 border-t border-border-soft pt-2">
            <Button
              type="button"
              variant="ghost"
              disabled={busy}
              onClick={() => flagsMutation.mutate({ id: item.id, pinned: !item.pinned })}
            >
              {item.pinned ? "Desfijar" : "Fijar"}
            </Button>
            <Button
              type="button"
              variant="ghost"
              disabled={busy}
              onClick={() => flagsMutation.mutate({ id: item.id, private: !item.private })}
            >
              {item.private ? "Hacer pública" : "Hacer privada"}
            </Button>
            <Button
              type="button"
              variant="ghost"
              disabled={busy}
              onClick={() => flagsMutation.mutate({ id: item.id, inactive: !item.inactive })}
            >
              {item.inactive ? "Reactivar" : "Desactivar"}
            </Button>
            <Button type="button" variant="ghost" disabled={busy} onClick={startEdit}>
              Editar
            </Button>
            {confirmingDelete ? (
              <div className="flex items-center gap-2">
                <span role="alert" className="text-xs text-danger">
                  ¿Eliminar? No se puede deshacer.
                </span>
                <Button type="button" variant="ghost" onClick={() => setConfirmingDelete(false)}>
                  Cancelar
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  autoFocus
                  disabled={busy}
                  onClick={() => {
                    setConfirmingDelete(false);
                    deleteMutation.mutate(item.id);
                  }}
                >
                  Confirmar
                </Button>
              </div>
            ) : (
              <Button type="button" variant="ghost" disabled={busy} onClick={() => setConfirmingDelete(true)}>
                Eliminar
              </Button>
            )}
          </div>
        </>
      )}
    </li>
  );
}

/**
 * Memoria card — counts inspector wired to GET /api/memoria/stats.
 * "Limpiar memoria" is destructive and irreversible, so it keeps a two-step
 * confirm (same pattern as ProfileEditor's delete-profile confirm) before
 * dispatching `clear_history` via useEngineCommand — no confirm dialog
 * component, just a local confirm/cancel row.
 */
export function MemoryCard() {
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
  const [listOpen, setListOpen] = useState(false);

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
        <h2 className="text-sm font-bold text-foreground">Memoria</h2>
        {clearCommand.pending && <Badge tone="info">aplicando…</Badge>}
      </div>

      <div className="flex flex-col gap-3.5 pt-3.5">
        {clearCommand.isError && (
          <p role="alert" className="text-xs leading-relaxed text-danger">
            {clearCommand.error?.message ?? "No se pudo limpiar la memoria."}
          </p>
        )}

        <section aria-labelledby="memory-clear-label" className="space-y-2">
          <span id="memory-clear-label" className="text-[11px] font-semibold uppercase tracking-[0.09em] text-dim">
            Acciones
          </span>
          {confirming ? (
            <div className="flex flex-col gap-2">
              <p role="alert" className="text-xs text-danger">
                ¿Limpiar memoria de Kira? No se puede deshacer.
              </p>
              <div className="flex gap-2">
                <Button type="button" variant="ghost" onClick={() => setConfirming(false)}>
                  Cancelar
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  autoFocus
                  disabled={clearCommand.pending}
                  onClick={handleConfirmClear}
                >
                  Confirmar
                </Button>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-[1fr_auto] items-center gap-3">
              <p className="text-xs leading-relaxed text-warn">
                Esta acción borra el historial de conversación de Kira; no se puede deshacer.
              </p>
              <Button type="button" variant="outline" disabled={clearCommand.pending} onClick={() => setConfirming(true)}>
                Limpiar memoria
              </Button>
            </div>
          )}
        </section>

        <section aria-labelledby="memory-counts-label" className="space-y-2">
          <span id="memory-counts-label" className="text-[11px] font-semibold uppercase tracking-[0.09em] text-dim">
            Memoria — solo conteos (sin contenido de chat)
          </span>
          {statsError && (
            <p role="alert" className="text-xs leading-relaxed text-danger">
              No se pudieron leer los conteos de memoria.
            </p>
          )}
          {data && (
            <div className="flex flex-col gap-2">
              {countRows(data).map(([label, count]) => (
                <div key={label} className="grid grid-cols-[1fr_auto] items-center gap-3">
                  <span className="text-[13px] text-foreground">{label}</span>
                  <Badge tone="neutral" mono>
                    {count}
                  </Badge>
                </div>
              ))}
            </div>
          )}
        </section>

        <section aria-labelledby="memory-list-label" className="space-y-2">
          <div className="flex items-center justify-between gap-3">
            <span id="memory-list-label" className="text-[11px] font-semibold uppercase tracking-[0.09em] text-dim">
              Memorias guardadas — detalle
            </span>
            <Button type="button" variant="ghost" onClick={() => setListOpen((open) => !open)}>
              {listOpen ? "Ocultar" : "Ver"}
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
                <p className="text-xs text-dim">Activá un perfil para ver sus memorias.</p>
              ) : (
                <>
                  {listError && (
                    <p role="alert" className="text-xs leading-relaxed text-danger">
                      No se pudo leer el detalle de memorias.
                    </p>
                  )}
                  {listData && listData.items.length === 0 && (
                    <p className="text-xs text-dim">No hay memorias guardadas.</p>
                  )}
                  {listData && listData.items.length > 0 && (
                    <ul className="flex max-h-64 flex-col gap-2 overflow-y-auto pr-1">
                      {listData.items.map((item) => (
                        <MemoriaRow key={item.id} item={item} profileId={profileId} />
                      ))}
                    </ul>
                  )}
                </>
              )}

              {purgeMutation.isError && (
                <p role="alert" className="text-xs leading-relaxed text-danger">
                  No se pudo purgar la memoria.
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
                      message: "Vas a borrar TODAS las memorias de Kira. No se puede deshacer.",
                      advanceLabel: "Continuar"
                    },
                    {
                      message: "Confirmá que entendés: se eliminan todas las memorias guardadas de este perfil.",
                      acknowledgment: "Sí, entiendo",
                      advanceLabel: "Continuar"
                    },
                    {
                      message: "Última confirmación. Esto es permanente y no se puede deshacer.",
                      advanceLabel: "Purgar definitivamente"
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
                  Purgar memorias
                </Button>
              )}
            </>
          )}
        </section>
      </div>
    </Card>
  );
}
