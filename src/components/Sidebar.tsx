import { ProfilePlaylist } from "./ProfilePlaylist.js";
import { cn } from "../lib/cn.js";

export type Section = "experiencia" | "controles" | "agenda" | "stream" | "musica";

interface NavItem {
  id: Section;
  icon: string;
  label: string;
}

// Flat, honest nav — every entry here is real and wired. Owner edits this
// array to add/reorder/remove sections; no inert placeholders live here.
const NAV_ITEMS: readonly NavItem[] = [
  { id: "experiencia", icon: "◈", label: "Experiencia" },
  { id: "agenda", icon: "▤", label: "Agenda" },
  { id: "stream", icon: "◉", label: "Stream" },
  { id: "musica", icon: "♪", label: "Música" },
  { id: "controles", icon: "⚙", label: "Controles" }
];

export interface SidebarProps {
  activeSection: Section;
  onSelect: (section: Section) => void;
}

/** <nav> region — primary nav (all 5 sections wired, flat and honest) +
 * the profiles-as-playlists list below the separator. */
export function Sidebar({ activeSection, onSelect }: SidebarProps) {
  return (
    <nav className="flex min-h-0 flex-col overflow-auto border-r border-border-soft bg-card py-3">
      <div className="flex flex-col gap-1 px-2 pb-3">
        {NAV_ITEMS.map((item) => {
          const isActive = item.id === activeSection;
          return (
            <button
              key={item.id}
              type="button"
              aria-current={isActive ? "true" : undefined}
              onClick={() => onSelect(item.id)}
              className={cn(
                "flex h-9 items-center gap-3 rounded-md px-3 font-mono text-sm font-semibold text-muted-foreground transition-colors",
                "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                "hover:bg-surface-2 hover:text-foreground",
                isActive && "bg-ok-bg text-[var(--kira-cyan)]"
              )}
            >
              <span aria-hidden="true">{item.icon}</span>
              {item.label}
            </button>
          );
        })}
      </div>

      <div className="mx-2 my-1 border-t border-border-soft" />

      <ProfilePlaylist />
    </nav>
  );
}
