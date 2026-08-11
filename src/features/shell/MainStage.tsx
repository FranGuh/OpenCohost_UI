import { KiraCover } from "../experiencia/KiraCover.js";
import { ControlsPanel } from "../controles/ControlsPanel.js";
import { AgendaPanel } from "../agenda/AgendaPanel.js";
import { StreamPanel } from "../stream/StreamPanel.js";
import { MusicPanel } from "../musica/MusicPanel.js";
import { MemoriaPanel } from "../memoria/MemoriaPanel.js";
import { SettingsSection } from "./SettingsSection.js";
import type { Section } from "./Sidebar.js";
import { useWelcomeStore } from "../../store/welcomeStore.js";
import { WelcomeCard } from "../experiencia/WelcomeCard.js";

export interface MainStageProps {
  activeSection: Section;
}

/** Main region — Kira's presence stage (Experiencia) or settings panels (Controles, Agenda, etc.). */
export function MainStage({ activeSection }: MainStageProps) {
  const welcomeDismissed = useWelcomeStore((state) => state.dismissed);
  const dismissWelcome = useWelcomeStore((state) => state.dismiss);

  // Controles/Agenda/Memoria own their full <main> (via SettingsSection) so
  // each can pin a pane switcher outside the scroll region — see
  // SettingsSection.tsx. Stream/Música have no switcher, so they render the
  // no-header branch — the exact single <main className={PANEL_CLASS}> this
  // file used to hand-roll, now routed through the same shared component
  // instead of a second copy of it (JD-9: SettingsSection's `if (!header)`
  // branch was otherwise unreachable — every other caller passes a header).
  if (activeSection === "controles") {
    return <ControlsPanel />;
  }

  if (activeSection === "agenda") {
    return <AgendaPanel />;
  }

  if (activeSection === "stream") {
    return (
      <SettingsSection>
        <StreamPanel />
      </SettingsSection>
    );
  }

  if (activeSection === "musica") {
    return (
      <SettingsSection>
        <MusicPanel />
      </SettingsSection>
    );
  }

  if (activeSection === "memoria") {
    return <MemoriaPanel />;
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
      {!welcomeDismissed && <WelcomeCard onDismiss={dismissWelcome} />}
      <div className="min-h-0 flex-1">
        <KiraCover />
      </div>
    </main>
  );
}
