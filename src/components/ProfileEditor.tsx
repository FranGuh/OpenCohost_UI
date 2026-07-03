import { useEffect, useRef, useState } from "react";
import type { FormEvent, KeyboardEvent as ReactKeyboardEvent } from "react";
import { Card } from "./ui/Card.js";
import { Button } from "./ui/Button.js";
import { useMockCommand } from "../api/mock/useMockCommand.js";

export type ProfileEditorMode = "create" | "edit";

interface ProfileEditorPayload {
  action: "save" | "delete";
  mode: ProfileEditorMode;
  name: string;
  systemPrompt?: string;
  purgeMemory?: boolean;
}

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
 * dialog — parity target: opencohost/ui/profiles_window.py. MOCK ONLY: the
 * backend exposes no create/rename/edit-prompt/delete endpoint (only
 * GET /api/perfiles + POST /api/perfiles/switch), so submit runs
 * useMockCommand (same accepted != applied contract as the Controles mock
 * cards) and surfaces a role="status" not-wired note — it never mutates the
 * real useProfileSwitch profile list or fabricates a persisted result.
 */
export function ProfileEditor({ open, mode, onClose, initialName = "" }: ProfileEditorProps) {
  const [name, setName] = useState(initialName);
  const [systemPrompt, setSystemPrompt] = useState("");
  const [nameTouched, setNameTouched] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [purgeMemory, setPurgeMemory] = useState(false);
  const [lastSubmitted, setLastSubmitted] = useState<ProfileEditorPayload | null>(null);
  const command = useMockCommand<ProfileEditorPayload>();
  const nameInputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLElement | null>(null);
  const initialNameRef = useRef(initialName);
  initialNameRef.current = initialName;

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
    setLastSubmitted(null);
    nameInputRef.current?.focus();
    return () => triggerRef.current?.focus();
  }, [open]);

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

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setNameTouched(true);
    if (!trimmedName) return;
    const payload: ProfileEditorPayload = { action: "save", mode, name: trimmedName, systemPrompt };
    setLastSubmitted(payload);
    void command.run(payload);
  }

  function handleConfirmDelete() {
    const payload: ProfileEditorPayload = {
      action: "delete",
      mode,
      name: trimmedName || initialName,
      purgeMemory
    };
    setLastSubmitted(payload);
    void command.run(payload);
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
              className="flex h-7 w-7 items-center justify-center rounded-full text-muted-foreground transition-colors hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
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
              {mode === "edit" && (
                <p className="text-xs text-dim">
                  El prompt actual no se puede leer del backend todavía — escribí uno nuevo o dejalo vacío para no
                  cambiarlo.
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
                        ¿Eliminar «{trimmedName || initialName}»? No se puede deshacer.
                      </p>
                      <div className="flex gap-2">
                        <Button type="button" variant="ghost" onClick={() => setConfirmDelete(false)}>
                          Cancelar
                        </Button>
                        <Button type="button" variant="outline" disabled={command.pending} onClick={handleConfirmDelete}>
                          Confirmar
                        </Button>
                      </div>
                    </div>
                  </div>
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

            {lastSubmitted && (
              <p role="status" className="text-xs leading-relaxed text-muted-foreground">
                {command.pending
                  ? "Aplicando…"
                  : "La gestión de perfiles se habilitará cuando el backend lo soporte — este cambio no se guardó."}
              </p>
            )}

            <div className="flex items-center justify-end gap-3 border-t border-border-soft pt-3.5">
              <Button type="button" variant="ghost" onClick={onClose}>
                Cancelar
              </Button>
              <Button type="submit" variant="primary" className="bg-[image:var(--spectrum)]" disabled={command.pending}>
                {command.pending ? "Guardando…" : "Guardar"}
              </Button>
            </div>
          </form>
        </Card>
      </div>
    </div>
  );
}
