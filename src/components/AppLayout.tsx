import { useState } from "react";
import { TopBar } from "./TopBar.js";
import { Sidebar } from "./Sidebar.js";
import type { Section } from "./Sidebar.js";
import { MainStage } from "./MainStage.js";
import { ConversationPanel } from "./ConversationPanel.js";
// import { PlayerBar } from "./PlayerBar.js";
import { ProfileSwitchProvider } from "../api/useProfileSwitch.js";

const GRID_STYLE = {
  display: "grid",
  gridTemplateColumns: "248px 1fr 372px",
  // gridTemplateRows: "60px 1fr 88px",
  gridTemplateAreas: '"top top top" "side main queue" "player player player"',
  height: "100vh",
  backgroundImage: "var(--app-bg-glow)",
  backgroundColor: "var(--background)"
} as const;

/**
 * Theme-independent player grid shell (top/side/main/queue/player). Owns
 * the working nav switch (Experiencia / Controles / Agenda) and hands it
 * down to Sidebar + MainStage. Also mounts the single ProfileSwitchProvider
 * above both ProfilePlaylist (Sidebar) and ProfileSwitcher (MainStage) so
 * they share one poll/reconcile owner instead of double-polling.
 */
export function AppLayout() {
  const [activeSection, setActiveSection] = useState<Section>("experiencia");

  return (
    <ProfileSwitchProvider>
      <div className="min-w-[1180px] text-foreground" style={GRID_STYLE}>
        <div className="grid [grid-area:top]">
          <TopBar />
        </div>
        <div className="grid min-h-0 [grid-area:side]">
          <Sidebar activeSection={activeSection} onSelect={setActiveSection} />
        </div>
        <div className="grid min-h-0 min-w-0 [grid-area:main]">
          <MainStage activeSection={activeSection} />
        </div>
        <div className="grid min-h-0 [grid-area:queue]">
          <ConversationPanel />
        </div>
        {/* <div className="grid [grid-area:player]">
          <PlayerBar />
        </div> */}
      </div>
    </ProfileSwitchProvider>
  );
}
