import { useState } from "react";
import { Pencil } from "lucide-react";
import { useProfileSwitchContext } from "../api/useProfileSwitch.js";
import { cn } from "../lib/cn.js";
import { ProfileEditor, type ProfileEditorMode } from "./ProfileEditor.js";

/** Which surface the single always-mounted ProfileEditor is showing: a new
 * profile ("+ Nuevo") or an existing one being edited (a row's pencil). `name`
 * is "" in create mode, the target profile in edit mode. */
type EditorState = { mode: ProfileEditorMode; name: string };

/** Profiles-as-playlists row list — reads the shared ProfileSwitchProvider
 * context so this and ProfileSwitcher have exactly one poll/reconcile
 * owner. */
export function ProfilePlaylist() {
  const { profiles, activeProfile, pendingSwitch, switchTo } = useProfileSwitchContext();
  const [editor, setEditor] = useState<EditorState | null>(null);

  return (
    <div className="flex flex-col gap-2 px-2 pb-3">
      <div className="flex items-center justify-between px-2">
        <span className="text-[11px] font-semibold uppercase tracking-[0.09em] text-dim">Perfiles</span>
        <button
          type="button"
          onClick={() => setEditor({ mode: "create", name: "" })}
          className="text-xs font-semibold text-muted-foreground hover:text-foreground"
        >
          ＋ Nuevo
        </button>
      </div>

      {/* One editor instance drives both flows; the pencil opens it prefilled in
          edit mode, "+ Nuevo" in create mode. */}
      <ProfileEditor
        open={editor !== null}
        mode={editor?.mode ?? "create"}
        initialName={editor?.name ?? ""}
        onClose={() => setEditor(null)}
      />

      <ul className="flex flex-col gap-1">
        {profiles.map((name) => {
          const isActive = name === activeProfile;
          const isPending = pendingSwitch?.name === name;
          return (
            <li key={name} className="group relative">
              <button
                type="button"
                onClick={() => switchTo(name)}
                className="flex w-full items-center gap-[10px] rounded-md px-2 py-[6px] pr-9 text-left transition-colors duration-fast ease-io hover:bg-surface-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              >
                <span
                  aria-hidden="true"
                  className={cn(
                    "flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-md bg-surface-2 text-xs font-bold text-muted-foreground",
                    isActive && "bg-[image:var(--spectrum-soft)] text-[var(--kira-cyan)]"
                  )}
                >
                  {name.charAt(0).toUpperCase()}
                </span>
                <span className="flex min-w-0 flex-col">
                  <span className={cn("truncate text-sm font-semibold text-foreground", isActive && "text-[var(--kira-cyan)]")}>
                    {name}
                  </span>
                  <span className="truncate text-xs text-dim">{isPending ? "aplicando…" : isActive ? "activo" : "perfil"}</span>
                </span>
              </button>
              {/* Separate button (never nested in the activate button — invalid
                  HTML) so a click edits without triggering the row's switch.
                  Hidden until the row is hovered or holds focus. */}
              <button
                type="button"
                aria-label={`Editar perfil ${name}`}
                onClick={() => setEditor({ mode: "edit", name })}
                className="absolute right-2 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded text-muted-foreground opacity-0 transition-opacity duration-fast ease-io hover:text-foreground focus-visible:opacity-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring group-hover:opacity-100 group-focus-within:opacity-100"
              >
                <Pencil size={13} aria-hidden="true" />
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
