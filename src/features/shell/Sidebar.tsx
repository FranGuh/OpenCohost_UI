import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import type { FocusEvent as ReactFocusEvent, PointerEvent as ReactPointerEvent } from "react";
import { Info, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { ProfilePlaylist } from "../perfiles/ProfilePlaylist.js";
import { usePerfilDetailQuery } from "../../api/profiles.js";
import { useProfileSwitchContext } from "../../api/useProfileSwitch.js";
import { cn } from "../../lib/cn.js";
import { useT, type TKey } from "../../i18n/t.js";

export type Section = "experiencia" | "controles" | "agenda" | "stream" | "musica";

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

interface PreviewState {
  name: string;
  /** Viewport px — the card uses position:fixed so it escapes the nav's
   * `overflow-auto` clip (an absolute card at left-full would be cut off). */
  left: number;
  top: number;
  /** True while the card is fading out — kept mounted (with cached prompt
   * still visible) until CLOSE_FADE_MS elapses, then unmounted. */
  closing: boolean;
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
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingNameRef = useRef<string | null>(null);
  // The row button we imperatively set aria-describedby on (its markup is in
  // ProfilePlaylist, so the wiring is done at runtime, not at the source).
  const describedRef = useRef<HTMLElement | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const [preview, setPreview] = useState<PreviewState | null>(null);
  // Clamped fixed-position top for the card. null until the first measure — the
  // card renders at the row's top for a single pre-paint frame, then the
  // useLayoutEffect below pins it inside the viewport (last-profile rows sit low
  // and were getting cut off at the bottom edge).
  const [clampedTop, setClampedTop] = useState<number | null>(null);
  const cardId = useId();

  // Real prompt preview (owner adjust round 3): fetched ONCE per profile and
  // cached forever (usePerfilDetailQuery — staleTime Infinity). `enabled` only
  // while a card is open, so the first hover fetches and every later hover of
  // the same profile is a cache-only read. Stays enabled during the closing
  // fade (preview is still non-null) so the prompt doesn't blank mid-exit.
  const detail = usePerfilDetailQuery(preview?.name ?? "", { enabled: preview !== null });

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    pendingNameRef.current = null;
  }, []);

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

  const showFor = useCallback((name: string, el: HTMLElement) => {
    // Cancel any in-flight exit fade — re-showing must not get unmounted by a
    // stale close timer scheduled a moment ago.
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
    const rect = el.getBoundingClientRect();
    setPreview({ name, left: rect.right + 8, top: rect.top, closing: false });
  }, []);

  // Exit path: flip to the closing state (fade out) and delay the actual
  // unmount + aria-describedby cleanup until CLOSE_FADE_MS elapses, so the card
  // fades rather than vanishing. Idempotent — a second hide during the fade is
  // a no-op (the timer is already pending).
  const hide = useCallback(() => {
    clearTimer();
    setPreview((current) => (current && !current.closing ? { ...current, closing: true } : current));
    if (closeTimerRef.current) return;
    closeTimerRef.current = setTimeout(() => {
      closeTimerRef.current = null;
      if (describedRef.current) {
        describedRef.current.removeAttribute("aria-describedby");
        describedRef.current = null;
      }
      setPreview(null);
    }, CLOSE_FADE_MS);
  }, [clearTimer]);

  function handlePointerOver(event: ReactPointerEvent<HTMLDivElement>) {
    const row = rowFor(event.target);
    if (!row) return; // over header / card / gap — keep whatever's shown (grace)
    // Already shown (and not mid-fade), or already the pending dwell → no-op. A
    // closing card of the same name is NOT skipped, so re-hovering re-opens it.
    if ((preview?.name === row.name && !preview.closing) || pendingNameRef.current === row.name) return;
    clearTimer();
    pendingNameRef.current = row.name;
    timerRef.current = setTimeout(() => {
      pendingNameRef.current = null;
      showFor(row.name, row.el);
    }, HOVER_INTENT_MS);
  }

  function handleFocus(event: ReactFocusEvent<HTMLDivElement>) {
    const row = rowFor(event.target);
    if (!row) return;
    clearTimer();
    const btn = (event.target as HTMLElement).closest("button");
    if (btn) {
      btn.setAttribute("aria-describedby", cardId);
      describedRef.current = btn;
    }
    showFor(row.name, row.el); // focus is immediate — no dwell
  }

  // Escape closes it — mirrors StatusChip's document-level listener so we don't
  // put a key handler on a non-interactive div. Only active while shown.
  useEffect(() => {
    if (!preview) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") hide();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [preview, hide]);

  // Cancel any pending dwell + exit-fade timers on unmount.
  useEffect(
    () => () => {
      clearTimer();
      if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    },
    [clearTimer]
  );

  // Clamp the fixed card so it always fits above the viewport bottom:
  // top = min(rowTop, innerHeight - cardHeight - 8). Measured after mount and
  // re-run when the fetched prompt replaces "cargando…" (that grows the card).
  // useLayoutEffect measures pre-paint so there's no visible jump. offsetHeight
  // is post-layout (0 in jsdom — tests stub it). The card's own max-h/overflow
  // caps a prompt taller than the viewport, so this never yields a negative top.
  useLayoutEffect(() => {
    if (!preview || !cardRef.current) return;
    const height = cardRef.current.offsetHeight;
    setClampedTop(Math.min(preview.top, window.innerHeight - height - 8));
  }, [preview, detail.isLoading, detail.isError, detail.data]);

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
          <p className="truncate text-sm font-semibold text-foreground">{preview.name}</p>
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
      <div className="flex shrink-0 flex-col gap-1 px-2 pb-2 pt-3">
        {NAV_ITEMS.map((item) => {
          const isActive = item.id === activeSection;
          return (
            <button
              key={item.id}
              type="button"
              aria-current={isActive ? "true" : undefined}
              // Accessible name survives collapse: the visible label is hidden,
              // so aria-label carries it. No native `title` — the unstyled
              // browser tooltip it produced was owner-rejected (a11y stays on
              // aria-label).
              aria-label={t(item.labelKey)}
              onClick={() => onSelect(item.id)}
              className={cn(
                "flex h-9 items-center rounded-md font-mono text-sm font-semibold text-muted-foreground transition-colors duration-fast ease-io",
                collapsed ? "justify-center px-0" : "gap-3 px-3",
                "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                "hover:bg-surface-2 hover:text-foreground",
                isActive && "bg-ok-bg text-[var(--kira-cyan)]"
              )}
            >
              <span aria-hidden="true">{item.icon}</span>
              {!collapsed && t(item.labelKey)}
            </button>
          );
        })}
      </div>

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
