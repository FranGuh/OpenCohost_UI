import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import type { FocusEvent as ReactFocusEvent, PointerEvent as ReactPointerEvent } from "react";
import { Info, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { ProfilePlaylist } from "../perfiles/ProfilePlaylist.js";
import { usePerfilDetailQuery } from "../../api/profiles.js";
import { useProfileSwitchContext } from "../../api/useProfileSwitch.js";
import { cn } from "../../lib/cn.js";
import { useT, type TKey } from "../../i18n/t.js";

export type Section = "experiencia" | "controles" | "agenda" | "stream" | "musica" | "memoria";

interface NavItem {
  id: Section;
  icon: string;
  labelKey: TKey;
}

// Flat, honest nav — every entry here is real and wired. Owner edits this
// array to add/reorder/remove sections; no inert placeholders live here.
const NAV_ITEMS: readonly NavItem[] = [
  { id: "experiencia", icon: "◈", labelKey: "shell.nav.experiencia" },
  { id: "agenda", icon: "▤", labelKey: "shell.nav.agenda" },
  { id: "stream", icon: "◉", labelKey: "shell.nav.stream" },
  { id: "musica", icon: "♪", labelKey: "shell.nav.musica" },
  { id: "memoria", icon: "◆", labelKey: "shell.nav.memoria" },
  { id: "controles", icon: "⚙", labelKey: "shell.nav.controles" }
];

// Hover dwell before the profile preview card appears. Keyboard focus shows it
// immediately (standard tooltip intent pattern — see ProfilesRegion).
const HOVER_INTENT_MS = 700;
// Exit-fade duration before the card unmounts — matches --dur-base (220ms) so
// the JS unmount lands right as the opacity transition ends. Reduced-motion is
// globally neutralized in styles.css (transition-duration → 0.01ms), so the
// card still unmounts on this timer, just without a visible fade.
const CLOSE_FADE_MS = 220;

interface AnchoredCard<T> {
  /** Whatever the caller renders — a profile name, a nav label. Compared with
   * `Object.is`, so keep it primitive or referentially stable. */
  data: T;
  /** Viewport px — the card uses position:fixed so it escapes the nav's
   * `overflow-auto` clip (an absolute card at left-full would be cut off). */
  left: number;
  top: number;
  /** True while the card is fading out — kept mounted (with cached content
   * still visible) until CLOSE_FADE_MS elapses, then unmounted. */
  closing: boolean;
}

/**
 * The floating-card state machine shared by both hover surfaces in this rail:
 * PERFILES rows (a prompt preview) and, once collapsed, the nav icons (a name
 * label). Presentation stays with the caller — the two cards hold different
 * content — but none of the four behaviours underneath is a one-liner, and
 * having two copies of them in one file is how they drift apart:
 *
 *  1. dwell before opening on hover, immediate on focus;
 *  2. a fade-out that outlives the state flip (the card stays mounted through
 *     CLOSE_FADE_MS instead of vanishing);
 *  3. `position: fixed` anchored to the trigger's rect, to escape the nav's
 *     `overflow-auto` clip;
 *  4. a bottom-of-viewport clamp, so a trigger sitting low is not cut off.
 *
 * `onHidden` runs once the unmount actually lands — for cleanup that has to
 * outlive the fade, like releasing a runtime `aria-describedby`.
 */
function useAnchoredCard<T>(onHidden?: () => void) {
  const [card, setCard] = useState<AnchoredCard<T> | null>(null);
  // Clamped fixed-position top. null until the first measure — the card renders
  // at the trigger's top for a single pre-paint frame, then the layout effect
  // below pins it inside the viewport.
  const [clampedTop, setClampedTop] = useState<number | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const dwellRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closeRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingRef = useRef<T | null>(null);
  // Held in a ref so `hide` stays referentially stable (it is wired straight to
  // JSX handlers) while still calling the caller's freshest cleanup.
  const onHiddenRef = useRef(onHidden);
  onHiddenRef.current = onHidden;

  const cancelDwell = useCallback(() => {
    if (dwellRef.current) {
      clearTimeout(dwellRef.current);
      dwellRef.current = null;
    }
    pendingRef.current = null;
  }, []);

  const openNow = useCallback(
    (data: T, el: HTMLElement) => {
      cancelDwell();
      // Cancel any in-flight exit fade — re-showing must not get unmounted by a
      // stale close timer scheduled a moment ago.
      if (closeRef.current) {
        clearTimeout(closeRef.current);
        closeRef.current = null;
      }
      const rect = el.getBoundingClientRect();
      setCard({ data, left: rect.right + 8, top: rect.top, closing: false });
    },
    [cancelDwell]
  );

  // Exit path: flip to the closing state (fade out) and delay the actual
  // unmount + caller cleanup until CLOSE_FADE_MS elapses, so the card fades
  // rather than vanishing. Idempotent — a second hide during the fade is a
  // no-op (the timer is already pending).
  const hide = useCallback(() => {
    cancelDwell();
    setCard((current) => (current && !current.closing ? { ...current, closing: true } : current));
    if (closeRef.current) return;
    closeRef.current = setTimeout(() => {
      closeRef.current = null;
      onHiddenRef.current?.();
      setCard(null);
    }, CLOSE_FADE_MS);
  }, [cancelDwell]);

  // Hover path. Not a useCallback: it reads `card` every render anyway and is
  // only ever called from event handlers.
  function openAfterDwell(data: T, el: HTMLElement) {
    // Already shown (and not mid-fade), or already the pending dwell → no-op. A
    // CLOSING card of the same data is NOT skipped, so re-hovering re-opens it.
    if ((card !== null && Object.is(card.data, data) && !card.closing) || Object.is(pendingRef.current, data)) return;
    cancelDwell();
    pendingRef.current = data;
    dwellRef.current = setTimeout(() => {
      pendingRef.current = null;
      openNow(data, el);
    }, HOVER_INTENT_MS);
  }

  // Escape closes it — mirrors StatusChip's document-level listener so we don't
  // put a key handler on a non-interactive div. Only active while shown.
  useEffect(() => {
    if (!card) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") hide();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [card, hide]);

  // Cancel any pending dwell + exit-fade timers on unmount.
  useEffect(
    () => () => {
      if (dwellRef.current) clearTimeout(dwellRef.current);
      if (closeRef.current) clearTimeout(closeRef.current);
    },
    []
  );

  // Clamp the fixed card so it always fits above the viewport bottom:
  // top = min(triggerTop, innerHeight - cardHeight - 8). useLayoutEffect
  // measures pre-paint so there's no visible jump. offsetHeight is post-layout
  // (0 in jsdom — tests stub it). Each card caps its own height, so this never
  // yields a negative top.
  //
  // No dep array on purpose. A card's height can change AFTER it opens
  // (ProfilesRegion swaps "cargando…" for the fetched prompt), and re-measuring
  // every commit covers that without each caller hand-maintaining a dep list
  // that rots silently the next time its content grows a branch. `setClampedTop`
  // bails on an unchanged value, so a stable height settles in one pass instead
  // of looping.
  useLayoutEffect(() => {
    if (!card || !cardRef.current) return;
    const height = cardRef.current.offsetHeight;
    setClampedTop(Math.min(card.top, window.innerHeight - height - 8));
  });

  return { card, clampedTop, cardRef, openNow, openAfterDwell, hide, cancelDwell };
}

/**
 * Wraps the PERFILES list (ProfilePlaylist) and gives its rows a floating
 * preview card on hover intent / focus, so profiles read as a commodity you can
 * browse rather than inert text. The row markup lives in ProfilePlaylist (out
 * of this change's scope), so this attaches via event delegation on a wrapper
 * instead of editing each row: a hovered/focused element is mapped back to its
 * profile by the index of its <li> inside ProfilePlaylist's single <ul>, which
 * renders one <li> per profile in `profiles` order.
 * ponytail: this index-mapping couples to that render shape; a data-attr on the
 * row would decouple it, but that file is out of scope here.
 */
function ProfilesRegion({ collapsed }: { collapsed: boolean }) {
  const t = useT();
  const { profiles } = useProfileSwitchContext();
  const regionRef = useRef<HTMLDivElement>(null);
  // The row button we imperatively set aria-describedby on (its markup is in
  // ProfilePlaylist, so the wiring is done at runtime, not at the source).
  // Released by the hook's onHidden, after the fade — not on the state flip, or
  // the description would drop while the card is still on screen.
  const describedRef = useRef<HTMLElement | null>(null);
  const releaseDescribedBy = useCallback(() => {
    if (describedRef.current) {
      describedRef.current.removeAttribute("aria-describedby");
      describedRef.current = null;
    }
  }, []);
  const { card: preview, clampedTop, cardRef, openNow, openAfterDwell, hide, cancelDwell } =
    useAnchoredCard<string>(releaseDescribedBy);
  const cardId = useId();

  // Real prompt preview (owner adjust round 3): fetched ONCE per profile and
  // cached forever (usePerfilDetailQuery — staleTime Infinity). `enabled` only
  // while a card is open, so the first hover fetches and every later hover of
  // the same profile is a cache-only read. Stays enabled during the closing
  // fade (preview is still non-null) so the prompt doesn't blank mid-exit.
  const detail = usePerfilDetailQuery(preview?.data ?? "", { enabled: preview !== null });

  // Maps a hovered/focused element to its profile row, or null for the header /
  // "+ Nuevo" button / anything outside a row.
  const rowFor = useCallback(
    (target: EventTarget | null): { name: string; el: HTMLElement } | null => {
      const el = target as HTMLElement | null;
      const li = el?.closest("li");
      const ul = li?.parentElement;
      if (!li || !ul || ul.tagName !== "UL" || !regionRef.current?.contains(ul)) return null;
      const index = Array.prototype.indexOf.call(ul.children, li);
      const name = profiles[index];
      if (name === undefined) return null;
      return { name, el: li as HTMLElement };
    },
    [profiles]
  );

  function handlePointerOver(event: ReactPointerEvent<HTMLDivElement>) {
    const row = rowFor(event.target);
    if (!row) return; // over header / card / gap — keep whatever's shown (grace)
    openAfterDwell(row.name, row.el);
  }

  function handleFocus(event: ReactFocusEvent<HTMLDivElement>) {
    const row = rowFor(event.target);
    if (!row) return;
    cancelDwell();
    const btn = (event.target as HTMLElement).closest("button");
    if (btn) {
      btn.setAttribute("aria-describedby", cardId);
      describedRef.current = btn;
    }
    openNow(row.name, row.el); // focus is immediate — no dwell
  }

  return (
    <div
      ref={regionRef}
      // Only the profiles list scrolls (flex-1 min-h-0 overflow-y-auto); the nav
      // above stays fixed. The fixed-position preview card is anchored to a row's
      // rect at open time and does NOT track scroll, so it would visually detach
      // if the list scrolled under it — hide it on scroll (onScroll only while a
      // card is open, so idle scrolling schedules no timers).
      className="relative flex-1 min-h-0 overflow-y-auto"
      onPointerOver={handlePointerOver}
      onPointerLeave={hide}
      onScroll={preview ? hide : undefined}
      onFocus={handleFocus}
      onBlur={hide}
    >
      <ProfilePlaylist collapsed={collapsed} />
      {preview && (
        <div
          id={cardId}
          ref={cardRef}
          role="tooltip"
          style={{ position: "fixed", left: preview.left, top: clampedTop ?? preview.top }}
          className={cn(
            "z-50 max-h-[calc(100vh-16px)] w-64 overflow-y-auto rounded-md border border-border-soft bg-card p-3 shadow-panel transition-opacity duration-base ease-io",
            // Entry rises + fades in; exit swaps the one-shot animation for a
            // plain opacity transition so it fades out before unmount (§3b).
            preview.closing ? "opacity-0" : "animate-rise-in opacity-100"
          )}
        >
          <p className="truncate text-sm font-semibold text-foreground">{preview.data}</p>
          <p className="mt-1 flex items-center gap-1.5 text-[11px] text-dim">
            <Info size={11} aria-hidden="true" />
            {t("shell.profilePreview.hint")}
          </p>
          <p className="mt-2 line-clamp-5 text-xs text-muted-foreground">
            {detail.isLoading ? (
              <span className="text-dim">{t("shell.profilePreview.loading")}</span>
            ) : detail.isError ? (
              t("shell.profilePreview.error")
            ) : detail.data?.prompt.trim() ? (
              detail.data.prompt
            ) : (
              <span className="text-dim">{t("shell.profilePreview.empty")}</span>
            )}
          </p>
        </div>
      )}
    </div>
  );
}

/**
 * Primary nav. Collapsed, the visible label is gone and only the glyph is left,
 * so hovering (or focusing) an item floats the section name beside it — the
 * same dwell/fade/clamp treatment the PERFILES rows get, minus the extra
 * content (owner request: "reusar, sólo mostrando el nombre de la tab").
 *
 * The card is `aria-hidden`. That name is ALREADY the button's `aria-label`,
 * which is what survives the collapse for assistive tech; wiring the card up as
 * an `aria-describedby` the way ProfilesRegion does would announce it twice.
 * This is decoration for sighted operators only.
 *
 * A native `title` would be fewer lines and was tried — the owner rejected the
 * unstyled browser tooltip it produces. Do not reintroduce it.
 */
function NavRail({
  activeSection,
  onSelect,
  collapsed
}: {
  activeSection: Section;
  onSelect: (section: Section) => void;
  collapsed: boolean;
}) {
  const t = useT();
  const { card, clampedTop, cardRef, openNow, openAfterDwell, hide } = useAnchoredCard<string>();

  return (
    <div className="flex shrink-0 flex-col gap-1 px-2 pb-2 pt-3">
      {NAV_ITEMS.map((item) => {
        const isActive = item.id === activeSection;
        const label = t(item.labelKey);
        return (
          <button
            key={item.id}
            type="button"
            aria-current={isActive ? "true" : undefined}
            // Accessible name survives collapse: the visible label is hidden,
            // so aria-label carries it. No native `title` — the unstyled
            // browser tooltip it produced was owner-rejected (a11y stays on
            // aria-label).
            aria-label={label}
            onClick={() => onSelect(item.id)}
            // Expanded, the label is right there — a card repeating it would be
            // noise, so the handlers are only wired in the icon rail.
            onPointerEnter={collapsed ? (event) => openAfterDwell(label, event.currentTarget) : undefined}
            onPointerLeave={collapsed ? hide : undefined}
            onFocus={collapsed ? (event) => openNow(label, event.currentTarget) : undefined}
            onBlur={collapsed ? hide : undefined}
            className={cn(
              "flex h-9 items-center rounded-md font-mono text-sm font-semibold text-muted-foreground transition-colors duration-fast ease-io",
              collapsed ? "justify-center px-0" : "gap-3 px-3",
              "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
              "hover:bg-surface-2 hover:text-foreground",
              isActive && "bg-ok-bg text-[var(--kira-cyan)]"
            )}
          >
            <span aria-hidden="true">{item.icon}</span>
            {!collapsed && label}
          </button>
        );
      })}
      {/* Gated on `card`, not on `collapsed`: only the collapsed handlers can
          ever create one, and gating on the flag too would strand a card
          mid-fade if the rail expanded underneath it. */}
      {card && (
        <div
          ref={cardRef}
          aria-hidden="true"
          style={{ position: "fixed", left: card.left, top: clampedTop ?? card.top }}
          className={cn(
            "pointer-events-none z-50 w-max max-w-[200px] rounded-md border border-border-soft bg-card px-2.5 py-1.5 text-sm font-semibold text-foreground shadow-panel transition-opacity duration-base ease-io",
            card.closing ? "opacity-0" : "animate-rise-in opacity-100"
          )}
        >
          {card.data}
        </div>
      )}
    </div>
  );
}

export interface SidebarProps {
  activeSection: Section;
  onSelect: (section: Section) => void;
  /** Icon-rail mode: nav labels + profile text hide, only icons/avatars show. */
  collapsed?: boolean;
  onToggleCollapse?: () => void;
}

/** <nav> region — primary nav (all 5 sections wired, flat and honest) +
 * the profiles-as-playlists list below the separator. Collapses to a ~60px
 * icon rail when `collapsed`, keeping every nav item's accessible name via
 * aria-label (the visible label is what's hidden). */
export function Sidebar({ activeSection, onSelect, collapsed = false, onToggleCollapse }: SidebarProps) {
  const t = useT();
  return (
    // The rail is a fixed-height flex column: [nav (fixed)] · [profiles (scrolls)]
    // · [footer toggle (fixed)]. overflow-hidden so the nav itself never scrolls —
    // only the flex-1 profiles region does.
    <nav className="flex min-h-0 flex-col overflow-hidden border-r border-border-soft bg-card">
      {/* Primary nav — pinned at the top, never scrolls with the profiles list. */}
      <NavRail activeSection={activeSection} onSelect={onSelect} collapsed={collapsed} />

      <div className="mx-2 my-1 shrink-0 border-t border-border-soft" />

      <ProfilesRegion collapsed={collapsed} />

      {/* Collapse toggle — integrated as a slim footer row (bottom, full-width,
          quiet ghost button) so it reads as part of the rail instead of floating
          at the top. aria-label + persistence (onToggleCollapse) are unchanged. */}
      <div className="shrink-0 border-t border-border-soft p-2">
        <button
          type="button"
          onClick={onToggleCollapse}
          aria-label={t(collapsed ? "shell.sidebarToggle.expand.aria" : "shell.sidebarToggle.collapse.aria")}
          className={cn(
            "flex h-9 w-full items-center rounded-md text-sm font-medium text-muted-foreground transition-colors duration-fast ease-io hover:bg-surface-2 hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
            collapsed ? "justify-center px-0" : "gap-3 px-3"
          )}
        >
          {collapsed ? <PanelLeftOpen size={18} aria-hidden="true" /> : <PanelLeftClose size={18} aria-hidden="true" />}
          {!collapsed && <span>{t("shell.sidebarToggle.label")}</span>}
        </button>
      </div>
    </nav>
  );
}
