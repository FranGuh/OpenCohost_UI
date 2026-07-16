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
import { useWelcomeStore } from "../store/welcomeStore.js";

const GRID_STYLE = {
  display: "grid",
  gridTemplateColumns: "248px 1fr 372px",
  // gridTemplateRows: "60px 1fr 88px",
  gridTemplateAreas: '"top top top" "side main queue" "player player player"',
  height: "100vh",
  backgroundImage: "var(--app-bg-glow)",
  backgroundColor: "var(--background)"
} as const;

// Sidebar column width: full nav vs. icon-only rail. The width animates via the
// grid-template-columns transition below (reduced-motion is globally neutralized
// in styles.css).
const SIDEBAR_WIDTH = { expanded: "248px", collapsed: "60px" } as const;
const SIDEBAR_COLLAPSED_KEY = "oc-sidebar-collapsed";

function readSidebarCollapsed(): boolean {
  try {
    return window.localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "1";
  } catch {
    return false;
  }
}

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
  // Collapsed rail state lives here — AppLayout sizes the sidebar grid column
  // and Sidebar renders the rail, so this is their nearest shared owner (no new
  // module store needed). Persisted under "oc-sidebar-collapsed" ("1"/"0"),
  // mirroring the oc-collapse-* / oc-density idiom.
  const [sidebarCollapsed, setSidebarCollapsed] = useState(readSidebarCollapsed);
  const restoreWelcome = useWelcomeStore((state) => state.restore);

  function handleShowWelcome() {
    restoreWelcome();
    setActiveSection("experiencia");
  }

  function toggleSidebar() {
    setSidebarCollapsed((collapsed) => {
      const next = !collapsed;
      try {
        window.localStorage.setItem(SIDEBAR_COLLAPSED_KEY, next ? "1" : "0");
      } catch {
        // best-effort persistence; the in-memory flip still holds
      }
      return next;
    });
  }

  const gridStyle = {
    ...GRID_STYLE,
    gridTemplateColumns: `${sidebarCollapsed ? SIDEBAR_WIDTH.collapsed : SIDEBAR_WIDTH.expanded} 1fr 372px`,
    transition: "grid-template-columns var(--dur-base) var(--ease-io)"
  };

  return (
    <ProfileSwitchProvider>
      <PlaybackProvider>
        <MusicDuckingWatcher />
        <div className="min-w-[1180px] text-foreground" style={gridStyle}>
          <div className="grid [grid-area:top]">
            <TopBar onShowWelcome={handleShowWelcome} />
          </div>
          <div className="grid min-h-0 [grid-area:side]">
            <Sidebar
              activeSection={activeSection}
              onSelect={setActiveSection}
              collapsed={sidebarCollapsed}
              onToggleCollapse={toggleSidebar}
            />
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
