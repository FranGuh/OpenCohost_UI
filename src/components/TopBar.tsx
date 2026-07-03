import { StatusRail } from "./StatusRail.js";
import { SettingsPopover } from "./SettingsPopover.js";

/**
 * <header> region — brand lockup, a static (unwired, P2) search pill, and
 * the reused StatusRail badge cluster in the right cluster.
 */
export function TopBar() {
  return (
    <header className="flex h-full items-center gap-3.5 border-b border-border-soft bg-card px-4">
      <div className="flex items-center gap-[10px]">
        <span
          aria-hidden="true"
          className="flex h-[30px] w-[30px] items-center justify-center rounded-[9px] bg-[image:var(--spectrum)] text-sm font-extrabold text-[var(--accent-contrast)]"
        >
          K
        </span>
        <span className="text-sm font-bold text-foreground">OpenCohost</span>
      </div>

      <div className="hidden h-9 min-w-[220px] items-center rounded-full border border-border bg-background px-4 text-xs text-dim md:flex">
        Buscar…
      </div>

      <div className="ml-auto flex items-center gap-3">
        <StatusRail />
        <SettingsPopover />
        <button
          type="button"
          aria-label="cuenta"
          className="h-9 w-9 rounded-full bg-[image:var(--spectrum-soft)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        />
      </div>
    </header>
  );
}
