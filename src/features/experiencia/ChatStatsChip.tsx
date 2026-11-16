import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { Activity, BarChart3, Brain, Clock, Cpu, ExternalLink, Heart, MessageSquare, Search, Sparkles, Star, X, Zap } from "lucide-react";
import { useMemoriaStatsQuery } from "../../api/memoria.js";
import { useChatStatsStore } from "../../store/chatStatsStore.js";
import { useT } from "../../i18n/t.js";
import { cn } from "../../lib/cn.js";
import { UsageActivityPanel } from "./UsageActivityPanel.js";
import { SPONSOR_URL } from "../shell/supportUrls.js";

export interface ChatStatsChipProps {
  activeProfileId?: string;
  activeProfileName?: string;
  activeModelName?: string;
  isModelActive?: boolean;
  className?: string;
  align?: "left" | "right";
}

function formatSessionDuration(seconds: number): string {
  if (seconds < 60) return `${Math.max(1, seconds)}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remMinutes = minutes % 60;
  return `${hours}h ${remMinutes}m`;
}

export function ChatStatsChip({
  activeProfileId,
  activeProfileName,
  activeModelName,
  isModelActive,
  className,
  align = "left"
}: ChatStatsChipProps) {
  const t = useT();
  const popoverId = useId();
  const [isOpen, setIsOpen] = useState(false);
  const [activityOpen, setActivityOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  // Hook memory stats query safely (cached by TanStack Query, fail-open)
  const memoriaQuery = useMemoriaStatsQuery(activeProfileId || "");
  const memoryCount = memoriaQuery.data?.saved_memorias ?? memoriaQuery.data?.saved_memorias_total ?? 0;

  // Access store counters
  const searchesCount = useChatStatsStore((s) => s.searchesCount);
  const totalTurns = useChatStatsStore((s) => s.totalTurns);
  const profileTurns = useChatStatsStore((s) => s.getProfileTurns(activeProfileId));
  const avgLatencyMs = useChatStatsStore((s) => s.getAvgLatencyMs());
  const favoriteModel = useChatStatsStore((s) => s.getFavoriteModel());
  const getSessionDuration = useChatStatsStore((s) => s.getSessionDurationSeconds);

  // Sync model active state with the store
  const effectiveModelActive = isModelActive ?? Boolean(activeModelName && activeModelName !== "local");
  useEffect(() => {
    useChatStatsStore.getState().updateModelActiveState(effectiveModelActive);
  }, [effectiveModelActive]);

  // Live timer: active only while popover is open
  const [liveSeconds, setLiveSeconds] = useState(0);

  useEffect(() => {
    if (!isOpen) return;
    setLiveSeconds(getSessionDuration());
    if (!effectiveModelActive) return;

    const interval = setInterval(() => {
      setLiveSeconds(getSessionDuration());
    }, 1000);

    return () => clearInterval(interval);
  }, [isOpen, effectiveModelActive, getSessionDuration]);

  // Format session duration from liveSeconds when open
  const sessionDuration = useMemo(() => {
    if (!isOpen) return "";
    return formatSessionDuration(liveSeconds);
  }, [isOpen, liveSeconds]);

  const displayModel = useMemo(() => {
    const raw = activeModelName || favoriteModel || "local";
    return raw.replace(/:latest$/, "");
  }, [activeModelName, favoriteModel]);

  const latencyFormatted = useMemo(() => {
    if (avgLatencyMs == null) return "--";
    if (avgLatencyMs >= 1000) return `${(avgLatencyMs / 1000).toFixed(1)}s`;
    return `${avgLatencyMs}ms`;
  }, [avgLatencyMs]);

  // Click outside and Escape handler
  useEffect(() => {
    if (!isOpen) return;

    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    }

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setIsOpen(false);
      }
    }

    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleKeyDown);
    closeButtonRef.current?.focus();

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen]);

  const toggleOpen = useCallback(() => {
    setIsOpen((prev) => !prev);
  }, []);

  return (
    <div ref={containerRef} className={cn("relative shrink-0 text-left", isOpen && "z-50", className)}>
      {/* Titlebar Status Chip */}
      <button
        type="button"
        onClick={toggleOpen}
        aria-expanded={isOpen}
        aria-controls={popoverId}
        aria-haspopup="dialog"
        aria-label={t("experiencia.chatStats.chip.title")}
        title={t("experiencia.chatStats.chip.title")}
        style={{ WebkitAppRegion: "no-drag" }}
        className={cn(
          "mono relative z-20 inline-flex items-center gap-1.5 rounded-full border border-border bg-surface-2 px-3 py-1.5 text-[12.5px] font-semibold text-muted-foreground transition-colors duration-fast ease-io hover:bg-surface-3 hover:text-foreground",
          isOpen && "border-primary/40 bg-primary/10 text-primary"
        )}
      >
        <BarChart3 size={13} className={cn("text-dim shrink-0", isOpen && "text-primary")} aria-hidden="true" />
        <span className="mono">
          {profileTurns > 0 ? `${profileTurns}t` : t("experiencia.chatStats.chip.tag")}
        </span>
        {searchesCount > 0 && (
          <span className="mono text-[11px] text-dim" title={t("experiencia.chatStats.metrics.searches")}>
            · {searchesCount}s
          </span>
        )}
      </button>

      {/* Flyout Popover with Theme Backdrop */}
      {isOpen && (
        <div
          id={popoverId}
          role="dialog"
          aria-label={t("experiencia.chatStats.popover.title")}
          style={{
            WebkitAppRegion: "no-drag",
            backdropFilter: "var(--surface-blur)",
            WebkitBackdropFilter: "var(--surface-blur)",
          }}
          className={cn(
            "absolute top-full z-50 mt-1.5 w-80 max-w-[calc(100vw-2rem)]",
            "rounded-md border border-border-soft bg-card p-3.5 shadow-panel",
            align === "right" ? "right-0" : "left-0",
            "animate-rise-in focus:outline-none"
          )}
        >
          {/* Header */}
          <div className="flex items-start justify-between gap-2 pb-2">
            <div className="flex items-center gap-2">
              <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <Sparkles size={15} aria-hidden="true" />
              </div>
              <div>
                <h3 className="text-xs font-semibold text-foreground leading-tight">
                  {t("experiencia.chatStats.popover.title")}
                </h3>
                <p className="text-[10.5px] text-muted-foreground leading-tight">
                  {t("experiencia.chatStats.popover.subtitle")}
                </p>
              </div>
            </div>
            <button
              ref={closeButtonRef}
              type="button"
              onClick={() => setIsOpen(false)}
              aria-label={t("experiencia.chatStats.action.close")}
              style={{ WebkitAppRegion: "no-drag" }}
              className="rounded-md p-1 text-dim hover:bg-surface-2 hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
            >
              <X size={14} aria-hidden="true" />
            </button>
          </div>

          {/* Metric Grid (2 columns) - Borderless clean tiles */}
          <div className="my-2.5 grid grid-cols-2 gap-2">
            {/* Web Searches */}
            <div className="flex flex-col rounded-lg bg-surface-2/60 p-2.5">
              <div className="flex items-center gap-1.5 text-muted-foreground">
                <Search size={12} className="shrink-0 text-primary" aria-hidden="true" />
                <span className="text-[10px] font-medium truncate">{t("experiencia.chatStats.metrics.searches")}</span>
              </div>
              <span className="mono mt-1 text-sm font-semibold text-foreground">{searchesCount}</span>
              <span className="text-[9.5px] text-dim truncate">{t("experiencia.chatStats.metrics.searchesHint")}</span>
            </div>

            {/* Memories Captured */}
            <div className="flex flex-col rounded-lg bg-surface-2/60 p-2.5">
              <div className="flex items-center gap-1.5 text-muted-foreground">
                <Brain size={12} className="shrink-0 text-primary" aria-hidden="true" />
                <span className="text-[10px] font-medium truncate">{t("experiencia.chatStats.metrics.memories")}</span>
              </div>
              <span className="mono mt-1 text-sm font-semibold text-foreground">{memoryCount}</span>
              <span className="text-[9.5px] text-dim truncate">{t("experiencia.chatStats.metrics.memoriesHint")}</span>
            </div>

            {/* Profile Turns */}
            <div className="flex flex-col rounded-lg bg-surface-2/60 p-2.5">
              <div className="flex items-center gap-1.5 text-muted-foreground">
                <MessageSquare size={12} className="shrink-0 text-primary" aria-hidden="true" />
                <span className="text-[10px] font-medium truncate">{t("experiencia.chatStats.metrics.interactions")}</span>
              </div>
              <span className="mono mt-1 text-sm font-semibold text-foreground">{profileTurns}</span>
              <span className="text-[9.5px] text-dim truncate">
                {activeProfileName ? activeProfileName : t("experiencia.chatStats.metrics.interactionsHint")}
              </span>
            </div>

            {/* Inference Latency */}
            <div className="flex flex-col rounded-lg bg-surface-2/60 p-2.5">
              <div className="flex items-center gap-1.5 text-muted-foreground">
                <Zap size={12} className="shrink-0 text-primary" aria-hidden="true" />
                <span className="text-[10px] font-medium truncate">{t("experiencia.chatStats.metrics.latency")}</span>
              </div>
              <span className="mono mt-1 text-sm font-semibold text-foreground">{latencyFormatted}</span>
              <span className="text-[9.5px] text-dim truncate">{t("experiencia.chatStats.metrics.latencyHint")}</span>
            </div>

            {/* Preferred / Active Model */}
            <div className="flex flex-col rounded-lg bg-surface-2/60 p-2.5">
              <div className="flex items-center gap-1.5 text-muted-foreground">
                <Cpu size={12} className="shrink-0 text-primary" aria-hidden="true" />
                <span className="text-[10px] font-medium truncate">{t("experiencia.chatStats.metrics.model")}</span>
              </div>
              <span className="mono mt-1 text-xs font-semibold text-foreground truncate" title={displayModel}>
                {displayModel}
              </span>
              <span className="text-[9.5px] text-dim truncate">{t("experiencia.chatStats.metrics.modelHint")}</span>
            </div>

            {/* Session Time */}
            <div className="flex flex-col rounded-lg bg-surface-2/60 p-2.5">
              <div className="flex items-center gap-1.5 text-muted-foreground">
                <Clock size={12} className="shrink-0 text-primary" aria-hidden="true" />
                <span className="text-[10px] font-medium truncate">{t("experiencia.chatStats.metrics.sessionTime")}</span>
              </div>
              <span className="mono mt-1 text-sm font-semibold text-foreground">{sessionDuration}</span>
              <span className="text-[9.5px] text-dim truncate">{t("experiencia.chatStats.metrics.sessionTimeHint")}</span>
            </div>
          </div>

          {/* Opens the local usage Activity panel (calendar, tokens, compute time) */}
          <button
            type="button"
            onClick={() => {
              setIsOpen(false);
              setActivityOpen(true);
            }}
            style={{ WebkitAppRegion: "no-drag" }}
            className={cn(
              "mb-2.5 flex w-full items-center justify-center gap-1.5 rounded-md px-2.5 py-1.5",
              "bg-surface-2 text-[11px] font-semibold text-foreground",
              "transition-colors hover:bg-surface-3",
              "focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
            )}
          >
            <Activity size={12} className="shrink-0 text-primary" aria-hidden="true" />
            <span>{t("experiencia.chatStats.action.activity")}</span>
          </button>

          {/* Independent Project Support Section - Borderless */}
          <div className="rounded-lg bg-surface-2/40 p-2.5">
            <div className="flex items-center gap-1.5">
              <Heart size={12} className="text-red-400 shrink-0" aria-hidden="true" />
              <span className="text-[11px] font-semibold text-foreground">
                {t("experiencia.chatStats.sponsor.heading")}
              </span>
            </div>
            <p className="mt-1 text-[10.5px] text-muted-foreground leading-snug">
              {t("experiencia.chatStats.sponsor.text")}
            </p>

            <div className="mt-2.5 flex items-center gap-2">
              {/* Star on GitHub */}
              <a
                href="https://github.com/plynte-labs/OpenCohost"
                target="_blank"
                rel="noopener noreferrer"
                style={{ WebkitAppRegion: "no-drag" }}
                className={cn(
                  "flex flex-1 items-center justify-center gap-1.5 rounded-md px-2.5 py-1.5",
                  "bg-surface-2 text-[11px] font-semibold text-foreground",
                  "transition-colors hover:bg-surface-3",
                  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
                )}
              >
                <Star size={12} className="text-amber-400 shrink-0" aria-hidden="true" />
                <span>{t("experiencia.chatStats.sponsor.starAction")}</span>
                <ExternalLink size={10} className="text-dim shrink-0" aria-hidden="true" />
              </a>

              {/* Sponsor on GitHub */}
              <a
                href={SPONSOR_URL}
                target="_blank"
                rel="noopener noreferrer"
                style={{ WebkitAppRegion: "no-drag" }}
                className={cn(
                  "flex flex-1 items-center justify-center gap-1.5 rounded-md px-2.5 py-1.5",
                  "bg-red-500/10 text-[11px] font-semibold text-red-300",
                  "transition-colors hover:bg-red-500/20",
                  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
                )}
              >
                <Heart size={12} className="text-red-400 shrink-0" aria-hidden="true" />
                <span>{t("experiencia.chatStats.sponsor.sponsorAction")}</span>
                <ExternalLink size={10} className="text-red-400/60 shrink-0" aria-hidden="true" />
              </a>
            </div>
          </div>
        </div>
      )}

      <UsageActivityPanel open={activityOpen} onClose={() => setActivityOpen(false)} />
    </div>
  );
}
