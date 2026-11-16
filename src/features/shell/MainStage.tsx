import { KiraCover } from "../experiencia/KiraCover.js";
import { ControlsPanel } from "../controles/ControlsPanel.js";
import { AgendaPanel } from "../agenda/AgendaPanel.js";
import { StreamPanel } from "../stream/StreamPanel.js";
import { MusicPanel } from "../musica/MusicPanel.js";
import { MemoriaPanel } from "../memoria/MemoriaPanel.js";
import { SettingsSection } from "./SettingsSection.js";
import type { Section } from "./Sidebar.js";
import { SetupWelcomeSlot } from "../setup/SetupWelcomeSlot.js";
import { cn } from "../../lib/cn.js";

export interface MainStageProps {
  activeSection: Section;
}

/** Main region — Kira's presence stage (Experiencia) or settings panels (Controles, Agenda, etc.).
 * Experiencia (<KiraCover />) stays continuously mounted in the DOM to preserve the 3D/VRM WebGL
 * context, loaded assets, and animation mixer without cold re-downloads or shader rebuilds on navigation.
 */
export function MainStage({ activeSection }: MainStageProps) {
  return (
    <div className="relative h-full w-full min-h-0 min-w-0 grid grid-rows-1 grid-cols-1 overflow-hidden">
      {/* Default: Experiencia — Kira's full-bleed presence stage. Kept mounted for VRM WebGL persistence. */}
      <main
        className={cn(
          "flex h-full w-full flex-col overflow-hidden [grid-area:1/1]",
          activeSection !== "experiencia" && "hidden"
        )}
        style={{
          backgroundImage: "radial-gradient(90% 70% at 50% -5%, var(--accent-soft), transparent 80%)"
        }}
      >
        {/* First-run setup assistant (backend-driven); falls back to the WelcomeCard. */}
        <SetupWelcomeSlot />
        <div className="relative min-h-0 flex-1">
          <KiraCover />
        </div>
      </main>

      {/* Configuration panels mounted when active, occupying the exact same viewport cell */}
      <div
        className={cn(
          "h-full w-full min-h-0 min-w-0 flex flex-col [grid-area:1/1] overflow-hidden",
          activeSection === "experiencia" && "hidden"
        )}
      >
        {activeSection === "controles" && <ControlsPanel />}
        {activeSection === "agenda" && <AgendaPanel />}
        {activeSection === "stream" && (
          <SettingsSection>
            <StreamPanel />
          </SettingsSection>
        )}
        {activeSection === "musica" && (
          <SettingsSection>
            <MusicPanel />
          </SettingsSection>
        )}
        {activeSection === "memoria" && <MemoriaPanel />}
      </div>
    </div>
  );
}
