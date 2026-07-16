import { useEffect, useRef, useState } from "react";
import type { FormEvent, KeyboardEvent as ReactKeyboardEvent } from "react";
import { Card } from "./ui/Card.js";
import { Button } from "./ui/Button.js";
import {
  type ProfileUpdateRequest,
  useCreateProfileMutation,
  useDeleteProfileMutation,
  useProfileDetailQuery,
  useUpdateProfileMutation
} from "../api/profiles.js";
import { useMemoriaPurgeMutation } from "../api/memoria.js";

export type ProfileEditorMode = "create" | "edit";

export interface ProfileEditorProps {
  open: boolean;
  mode: ProfileEditorMode;
  onClose: () => void;
  /** Edit mode only — name of the profile being edited (prefilled). */
  initialName?: string;
}

const TITLES: Record<ProfileEditorMode, string> = {
  create: "Nuevo perfil",
  edit: "Editar perfil"
};

/**
 * Profile create / rename / edit-system-prompt / delete(+memoria-purge)
 * dialog — parity target: opencohost/ui/profiles_window.py. Wired to the
 * real CRUD routes (opencohost/api/main.py ~606-702): POST/PUT/GET/DELETE
 * /api/perfiles(/{name}). Edit mode hydrates the prompt from GET so a save
 * always resends a real value (never the old "empty means unchanged" mock
 * convention). `use_system` is read-only here (no UI control yet) — an
 * update never sends it, relying on the backend's partial-update contract
 * (an omitted field leaves the stored value unchanged).
 */
export function ProfileEditor({ open, mode, onClose, initialName = "" }: ProfileEditorProps) {
  const [name, setName] = useState(initialName);
  const [systemPrompt, setSystemPrompt] = useState("");
  const [nameTouched, setNameTouched] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [purgeMemory, setPurgeMemory] = useState(false);
  // Set only once the profile itself has already been deleted successfully
  // but the follow-up memoria purge failed — the profile no longer exists,
  // so retrying must re-attempt ONLY the purge, never the delete.
  const [purgeFailedAfterDelete, setPurgeFailedAfterDelete] = useState(false);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLElement | null>(null);
  const initialNameRef = useRef(initialName);
  initialNameRef.current = initialName;

  // Hydration query — only fetches while the dialog is open in edit mode, so
  // the always-mounted component never fetches in the background while
  // closed or while creating a new profile.
  const profileDetail = useProfileDetailQuery(open && mode === "edit" ? initialName : null);
  const createMutation = useCreateProfileMutation();
  const updateMutation = useUpdateProfileMutation();
  const deleteMutation = useDeleteProfileMutation();
  // Memoria rows are stored keyed by the profile's stable uuid, not its
  // display name — target the `id` hydrated from GET /api/perfiles/{name},
  // never `initialName`.
  const purgeMutation = useMemoriaPurgeMutation(profileDetail.data?.id ?? "");

  // On open: remember the trigger, reset from the open-time initialName (a
  // later activeProfile reconcile must not clobber in-progress input), and
  // move focus to the first field. On close: restore focus to the trigger
  // (WCAG 2.4.3).
  useEffect(() => {
    if (!open) return;
    triggerRef.current = document.activeElement as HTMLElement | null;
    setName(initialNameRef.current);
    setSystemPrompt("");
    setNameTouched(false);
    setConfirmDelete(false);
    setPurgeMemory(false);
    setPurgeFailedAfterDelete(false);
    createMutation.reset();
    updateMutation.reset();
    deleteMutation.reset();
    purgeMutation.reset();
    nameInputRef.current?.focus();
    return () => triggerRef.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Hydrate the prompt from the real backend once GET /api/perfiles/{name}
  // resolves. Declared AFTER the reset effect above so, on the same open
  // transition, this effect's write wins even when profileDetail.data was
  // already cached from a previous open of the same profile (in which case
  // its reference — and thus this effect's own dependency — never changes).
  useEffect(() => {
    if (!open || mode !== "edit" || !profileDetail.data) return;
    setSystemPrompt(profileDetail.data.prompt);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, mode, profileDetail.data]);

  // Trap Tab within the dialog while open (aria-modal only hides the
  // background from AT; it does not stop keyboard focus escaping).
  function handleDialogKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.key !== "Tab") return;
    const focusables = dialogRef.current?.querySelectorAll<HTMLElement>(
      'a[href],button:not([disabled]),input:not([disabled]),textarea:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])'
    );
    if (!focusables || focusables.length === 0) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  useEffect(() => {
    if (!open) return;
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  const trimmedName = name.trim();
  const nameInvalid = nameTouched && trimmedName.length === 0;
  const savePending = mode === "create" ? createMutation.isPending : updateMutation.isPending;
  const saveError = mode === "create" ? createMutation.error : updateMutation.error;

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setNameTouched(true);
    if (!trimmedName) return;

    if (mode === "create") {
      createMutation.mutate({ name: trimmedName, prompt: systemPrompt }, { onSuccess: onClose });
      return;
    }

    const body: ProfileUpdateRequest = { prompt: systemPrompt };
    if (trimmedName !== initialName) body.new_name = trimmedName;
    updateMutation.mutate({ name: initialName, body }, { onSuccess: onClose });
  }

  // Delete and purge run SEQUENTIALLY — the dialog only closes once both
  // steps that were requested actually succeed. If the purge fails after a
  // successful delete, the profile is already gone: keep the dialog open
  // and surface the failure instead of silently losing it (fire-and-forget
  // was the bug — a lost purge left orphaned memoria rows with no
  // indication anything went wrong).
  function handleConfirmDelete() {
    deleteMutation.mutate(initialName, {
      onSuccess: () => {
        if (!purgeMemory) {
          onClose();
          return;
        }
        purgeMutation.mutate(undefined, {
          onSuccess: onClose,
          onError: () => setPurgeFailedAfterDelete(true)
        });
      }
    });
  }

  function handleRetryPurge() {
    purgeMutation.mutate(undefined, {
      onSuccess: onClose,
      onError: () => setPurgeFailedAfterDelete(true)
    });
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="profile-editor-title"
        onKeyDown={handleDialogKeyDown}
        className="w-full max-w-md"
      >
        <Card className="flex flex-col p-4">
          <div className="flex items-center justify-between gap-3 border-b border-border-soft pb-3">
            <h2 id="profile-editor-title" className="text-sm font-bold text-foreground">
              {TITLES[mode]}
            </h2>
            <button
              type="button"
              aria-label="Cerrar"
              onClick={onClose}
              className="flex h-7 w-7 items-center justify-center rounded-full text-muted-foreground transition-colors duration-fast ease-io hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              ✕
            </button>
          </div>

          <form onSubmit={handleSubmit} className="flex flex-col gap-3.5 pt-3.5">
            <section className="space-y-2">
              <label
                htmlFor="profile-editor-name"
                className="text-[11px] font-semibold uppercase tracking-[0.09em] text-dim"
              >
                Nombre
              </label>
              <input
                id="profile-editor-name"
                ref={nameInputRef}
                type="text"
                value={name}
                onChange={(event) => setName(event.target.value)}
                onBlur={() => setNameTouched(true)}
                placeholder="Nombre del perfil"
                className="h-11 w-full rounded-md border border-border bg-background px-3 text-sm font-semibold text-foreground placeholder:text-dim focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              />
              {nameInvalid && (
                <p role="alert" className="text-xs text-danger">
                  El nombre no puede estar vacío.
                </p>
              )}
            </section>

            <section className="space-y-2">
              <label
                htmlFor="profile-editor-prompt"
                className="text-[11px] font-semibold uppercase tracking-[0.09em] text-dim"
              >
                System prompt
              </label>
              <textarea
                id="profile-editor-prompt"
                value={systemPrompt}
                onChange={(event) => setSystemPrompt(event.target.value)}
                rows={5}
                placeholder="Escribí la personalidad de Kira…"
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-dim focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              />
              {mode === "edit" && profileDetail.isError && (
                <p role="alert" className="text-xs text-danger">
                  No se pudo cargar el perfil.
                </p>
              )}
            </section>

            {mode === "edit" && (
              <section
                aria-labelledby="profile-editor-delete-label"
                className="space-y-2 border-t border-border-soft pt-3.5"
              >
                <span
                  id="profile-editor-delete-label"
                  className="text-[11px] font-semibold uppercase tracking-[0.09em] text-dim"
                >
                  Eliminar perfil
                </span>
                {confirmDelete ? (
                  purgeFailedAfterDelete ? (
                    // The profile itself is already gone at this point — only
                    // the purge can be retried, never the delete again.
                    <div className="flex flex-col gap-2">
                      <p role="alert" className="text-xs text-danger">
                        Se eliminó «{initialName}», pero no se pudo purgar su memoria asociada.
                      </p>
                      <div className="flex justify-end">
                        <Button
                          type="button"
                          variant="outline"
                          disabled={purgeMutation.isPending}
                          onClick={handleRetryPurge}
                        >
                          {purgeMutation.isPending ? "Reintentando…" : "Reintentar purga"}
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex flex-col gap-2">
                      <label className="flex items-center gap-2 text-xs text-foreground">
                        <input
                          type="checkbox"
                          checked={purgeMemory}
                          onChange={(event) => setPurgeMemory(event.target.checked)}
                          className="h-4 w-4 accent-danger"
                        />
                        Purgar memoria asociada a este perfil
                      </label>
                      <div className="grid grid-cols-[1fr_auto] items-center gap-3">
                        <p className="text-xs text-danger">
                          ¿Eliminar «{initialName}»? No se puede deshacer.
                        </p>
                        <div className="flex gap-2">
                          <Button type="button" variant="ghost" onClick={() => setConfirmDelete(false)}>
                            Cancelar
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            disabled={deleteMutation.isPending}
                            onClick={handleConfirmDelete}
                          >
                            {deleteMutation.isPending ? "Eliminando…" : "Confirmar"}
                          </Button>
                        </div>
                      </div>
                      {deleteMutation.isError && (
                        <p role="alert" className="text-xs text-danger">
                          {deleteMutation.error?.message ?? "No se pudo eliminar el perfil."}
                        </p>
                      )}
                    </div>
                  )
                ) : (
                  <div className="grid grid-cols-[1fr_auto] items-center gap-3">
                    <span className="text-[13px] text-foreground">Eliminar este perfil.</span>
                    <Button type="button" variant="outline" onClick={() => setConfirmDelete(true)}>
                      Eliminar
                    </Button>
                  </div>
                )}
              </section>
            )}

            {saveError && (
              <p role="alert" className="text-xs leading-relaxed text-danger">
                {saveError.message ?? "No se pudo guardar el perfil."}
              </p>
            )}

            <div className="flex items-center justify-end gap-3 border-t border-border-soft pt-3.5">
              <Button type="button" variant="ghost" onClick={onClose}>
                Cancelar
              </Button>
              <Button type="submit" variant="primary" className="bg-[image:var(--spectrum)]" disabled={savePending}>
                {savePending ? "Guardando…" : "Guardar"}
              </Button>
            </div>
          </form>
        </Card>
      </div>
    </div>
  );
}
