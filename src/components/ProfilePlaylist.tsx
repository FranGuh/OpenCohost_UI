import { useProfileSwitchContext } from "../api/useProfileSwitch.js";
import { cn } from "../lib/cn.js";

/** Profiles-as-playlists row list — reads the shared ProfileSwitchProvider
 * context so this and ProfileSwitcher have exactly one poll/reconcile
 * owner. */
export function ProfilePlaylist() {
  const { profiles, activeProfile, pendingSwitch, switchTo } = useProfileSwitchContext();

  return (
    <div className="flex flex-col gap-2 px-2 pb-3">
      <div className="flex items-center justify-between px-2">
        <span className="text-[11px] font-semibold uppercase tracking-[0.09em] text-dim">Perfiles</span>
        <button type="button" disabled title="Próximamente" className="text-xs font-semibold text-dim">
          ＋ Nuevo
        </button>
      </div>

      <ul className="flex flex-col gap-1">
        {profiles.map((name) => {
          const isActive = name === activeProfile;
          const isPending = pendingSwitch?.name === name;
          return (
            <li key={name}>
              <button
                type="button"
                onClick={() => switchTo(name)}
                className="flex w-full items-center gap-[10px] rounded-md px-2 py-[6px] text-left transition-colors hover:bg-surface-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
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
            </li>
          );
        })}
      </ul>
    </div>
  );
}
