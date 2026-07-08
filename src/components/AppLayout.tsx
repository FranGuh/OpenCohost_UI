import { useState } from "react";
import { TopBar } from "./TopBar.js";
import { Sidebar } from "./Sidebar.js";
import type { Section } from "./Sidebar.js";
import { MainStage } from "./MainStage.js";
import { ConversationPanel } from "./ConversationPanel.js";
// import { PlayerBar } from "./PlayerBar.js";
import { ProfileSwitchProvider } from "../api/useProfileSwitch.js";
import { PlaybackProvider } from "../state/PlaybackProvider.js";
import { MusicDuckingWatcher } from "../state/MusicDuckingWatcher.js";

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
 *
 * PlaybackProvider (WU-G) is mounted here too, ABOVE MainStage's
 * activeSection switch — MusicPanel used to own the shared <audio> element
 * directly, so switching away from "musica" unmounted it and killed
 * playback. Owning it at this level means the element's lifetime is the app
 * session, not whichever section happens to be visible.
 *
 * MusicDuckingWatcher (FIX-D) is mounted INSIDE PlaybackProvider, alongside
 * the rest of the persistent chrome — it renders nothing, it just bridges
 * the live is_speaking poll into PlaybackProvider's `ducked` flag so the
 * music bed auto-ducks while Kira talks, from wherever the user happens to
 * be navigated.
 */
export function AppLayout() {
  const [activeSection, setActiveSection] = useState<Section>("experiencia");

  return (
    <ProfileSwitchProvider>
      <PlaybackProvider>
        <MusicDuckingWatcher />
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
      </PlaybackProvider>
    </ProfileSwitchProvider>
  );
}
