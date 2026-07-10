import { BrandMark } from "./ui/BrandMark.js";
import { StatusRail } from "./StatusRail.js";
import { SettingsPopover } from "./SettingsPopover.js";

/**
 * <header> region — brand lockup (ring mark + wordmark + tagline) and the
 * reused StatusRail badge cluster in the right cluster.
 */
export interface TopBarProps {
  onShowWelcome(): void;
}

export function TopBar({ onShowWelcome }: TopBarProps) {
  return (
    <header className="flex h-full items-center gap-3.5 border-b border-border-soft bg-card px-4">
      <div className="flex items-center gap-2.5">
        <BrandMark size={30} aria-hidden />
        <div className="flex flex-col leading-tight">
          <span className="font-sans text-sm font-bold text-foreground">
            Open<span className="text-[var(--kira-cyan)]">Cohost</span>
          </span>
          <span className="font-mono text-[9px] uppercase tracking-[0.14em] text-muted-foreground">
            focus over panic
          </span>
        </div>
      </div>

      <div className="ml-auto flex items-center gap-3">
        <StatusRail />
        <SettingsPopover onShowWelcome={onShowWelcome} />
        <button
          type="button"
          aria-label="cuenta"
          className="h-9 w-9 rounded-full bg-[color:var(--accent-soft)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        />
      </div>
    </header>
  );
}
