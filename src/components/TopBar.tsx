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
          <span className="flex items-center gap-1.5 font-mono text-[9px] uppercase tracking-[0.12em] text-muted-foreground">
            <span>focus over panic</span>
            <span aria-hidden="true" className="text-border">/</span>
            <a
              href="https://github.com/franguh"
              target="_blank"
              rel="noreferrer"
              aria-label="Developed by Franguh"
              className="normal-case tracking-normal transition-colors duration-fast ease-io hover:text-[var(--kira-cyan)] focus-visible:rounded-sm focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              Developed by Franguh
            </a>
          </span>
        </div>
      </div>

      <div className="ml-auto flex min-w-0 items-center gap-3">
        <StatusRail />
        <SettingsPopover onShowWelcome={onShowWelcome} />
      </div>
    </header>
  );
}
