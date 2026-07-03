import { ProfilePlaylist } from "./ProfilePlaylist.js";
import { cn } from "../lib/cn.js";

export type Section = "experiencia" | "controles" | "agenda" | "stream";

interface NavItem {
  id: Section | "buscar" | "ajustes";
  icon: string;
  label: string;
  wired: boolean;
}

// "Biblioteca" (formerly inert) is repurposed as the Agenda nav entry, and
// "Inicio" (formerly inert) as the Stream nav entry — Buscar/Ajustes stay
// inert placeholders for later waves. Order reads as the coherent wired
// product flow: Experiencia -> Agenda -> Stream -> Controles.
const NAV_ITEMS: readonly NavItem[] = [
  { id: "experiencia", icon: "◈", label: "Experiencia", wired: true },
  { id: "agenda", icon: "▤", label: "Agenda", wired: true },
  { id: "stream", icon: "◉", label: "Stream", wired: true },
  { id: "controles", icon: "⚙", label: "Controles", wired: true },
  { id: "buscar", icon: "⌕", label: "Buscar", wired: false },
  { id: "ajustes", icon: "☰", label: "Ajustes", wired: false }
];

export interface SidebarProps {
  activeSection: Section;
  onSelect: (section: Section) => void;
}

/** <nav> region — primary nav (only Experiencia/Controles wired) + the
 * profiles-as-playlists list below the separator. */
export function Sidebar({ activeSection, onSelect }: SidebarProps) {
  return (
    <nav className="flex min-h-0 flex-col overflow-auto border-r border-border-soft bg-card py-3">
      <div className="flex flex-col gap-1 px-2 pb-3">
        {NAV_ITEMS.map((item) => {
          const isActive = item.wired && item.id === activeSection;
          return (
            <button
              key={item.id}
              type="button"
              disabled={!item.wired}
              aria-current={isActive ? "true" : undefined}
              title={item.wired ? undefined : "Próximamente"}
              onClick={() => item.wired && onSelect(item.id as Section)}
              className={cn(
                "flex h-9 items-center gap-3 rounded-md px-3 text-sm font-semibold text-muted-foreground transition-colors",
                "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                item.wired && "hover:bg-surface-2 hover:text-foreground",
                !item.wired && "cursor-not-allowed opacity-50",
                isActive && "bg-[image:var(--spectrum-soft)] text-[var(--kira-cyan)]"
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
