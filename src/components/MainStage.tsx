import { KiraCover } from "./KiraCover.js";
import { ProfileSwitcher } from "./ProfileSwitcher.js";
import { ModelCard } from "./ModelCard.js";
import { VoiceCard } from "./VoiceCard.js";
import { PTTCard } from "./PTTCard.js";
import { MemoryCard } from "./MemoryCard.js";
import { PersonalizationCard } from "./PersonalizationCard.js";
import { AvatarCard } from "./AvatarCard.js";
import { ObsCard } from "./ObsCard.js";
import { AgendaPanel } from "./AgendaPanel.js";
import { StreamPanel } from "./StreamPanel.js";
import { MusicPanel } from "./MusicPanel.js";
import type { Section } from "./Sidebar.js";
import { useWelcomeStore } from "../store/welcomeStore.js";
import { WelcomeCard } from "./WelcomeCard.js";

const PANEL_CLASS = "flex min-h-0 flex-col gap-3.5 overflow-auto p-4";
const PANEL_GRADIENT = "radial-gradient(60% 40% at 50% 0%, var(--accent-soft), transparent 70%)";

export interface MainStageProps {
  activeSection: Section;
}

/** Main region — Kira's presence stage (Experiencia) or settings panels (Controles, Agenda, etc.). */
export function MainStage({ activeSection }: MainStageProps) {
  const welcomeDismissed = useWelcomeStore((state) => state.dismissed);
  const dismissWelcome = useWelcomeStore((state) => state.dismiss);

  if (activeSection === "controles") {
    return (
      <main className={PANEL_CLASS} style={{ backgroundImage: PANEL_GRADIENT }}>
        <ProfileSwitcher />
        <ModelCard />
        <VoiceCard />
        <PTTCard />
        <MemoryCard />
        <PersonalizationCard />
        <AvatarCard />
        <ObsCard />
      </main>
    );
  }

  if (activeSection === "agenda") {
    return (
      <main className={PANEL_CLASS} style={{ backgroundImage: PANEL_GRADIENT }}>
        <AgendaPanel />
      </main>
    );
  }

  if (activeSection === "stream") {
    return (
      <main className={PANEL_CLASS} style={{ backgroundImage: PANEL_GRADIENT }}>
        <StreamPanel />
      </main>
    );
  }

  if (activeSection === "musica") {
    return (
      <main className={PANEL_CLASS} style={{ backgroundImage: PANEL_GRADIENT }}>
        <MusicPanel />
      </main>
    );
  }

  // Default: Experiencia — Kira's full-bleed presence stage.
  // KiraCover manages its own centering and glow; h-full gives it the app's
  // remaining height so it fills the column without scrolling.
  return (
    <main
      className="flex h-full w-full flex-col overflow-hidden"
      style={{
        backgroundImage: "radial-gradient(90% 70% at 50% -5%, var(--accent-soft), transparent 80%)"
      }}
    >
      {!welcomeDismissed && (
        <div className="shrink-0 px-4 pt-4">
          <WelcomeCard onDismiss={dismissWelcome} />
        </div>
      )}
      <div className="min-h-0 flex-1">
        <KiraCover />
      </div>
    </main>
  );
}
