import type { SyntheticEvent } from "react";
import { AVATAR_IMAGE, FALLBACK_AVATAR } from "./kiraState.js";

export interface WelcomeCardProps {
  onDismiss(): void;
}

function handleAvatarError(event: SyntheticEvent<HTMLImageElement>): void {
  event.currentTarget.src = FALLBACK_AVATAR;
}

export function WelcomeCard({ onDismiss }: WelcomeCardProps) {
  return (
    <section
      aria-labelledby="welcome-card-title"
      className="grid w-full grid-cols-[32px_1fr_auto_56px] items-center gap-3 rounded-lg border border-border bg-card p-2.5 shadow-panel"
    >
      <img src="/brand/opencohost.png" alt="OpenCohost" className="h-8 w-8 object-contain" />

      <div className="min-w-0">
        <h2 id="welcome-card-title" className="text-sm font-bold text-foreground">
          Bienvenido a OpenCohost
        </h2>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
          Kira está en el centro de la experiencia. Conversá con ella y ajustá perfiles o controles cuando lo necesites.
        </p>
      </div>

      <button
        type="button"
        onClick={onDismiss}
        className="rounded-md border border-border px-3 py-1.5 font-mono text-xs font-semibold text-foreground transition-colors hover:bg-surface-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        Entendido
      </button>

      <img
        src={AVATAR_IMAGE.idle}
        onError={handleAvatarError}
        alt="Kira"
        className="h-14 w-14 rounded-full border border-ring bg-background object-contain"
      />
    </section>
  );
}
