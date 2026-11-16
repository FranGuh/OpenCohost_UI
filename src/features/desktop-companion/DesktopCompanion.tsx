import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Mic, Send, AlertCircle, Play, Square, SkipBack, SkipForward, X } from "lucide-react";
import { bootstrapBackend } from "../../lib/backendBootstrap.js";
import { bootstrapApiToken, getApiBaseUrl, getAuthHeaders } from "../../api/client.js";
import { VrmApi, localBackend } from "../avatar-vrm/domain/vrmApi.js";
import type { VrmLipSync } from "../avatar-vrm/domain/vrmLipSync.js";
import { extractBearerToken, startManagedVrmLipSync } from "../avatar-vrm/domain/vrmLipSyncLifecycle.js";
import { VrmStage } from "../avatar-vrm/components/VrmStage.js";
import { useStatusQuery } from "../../api/status.js";
import { useServerEventLog } from "../../api/events.js";
import { isVisionActivePhase, useVisionPhaseStore } from "../../store/visionStore.js";
import { useLookNow, useVisionQuery } from "../../api/vision.js";
import { executeVisionCommand, isComposerCommandPrefix, parseVisionCommand } from "../../lib/visionCommand.js";
import { usePttHold } from "../../api/ptt.js";
import { useSendChatTurn } from "../../api/chat.js";
import {
  getDesktopState,
  onDesktopState,
  desktopReady,
  type DesktopSnapshot,
} from "./desktopClient.js";
import { gestureKind, type GestureKind } from "./gesture.js";
import { shouldCollapseOnBlur } from "./blurGrace.js";
import { publishAcceptedCompanionTurn } from "./operatorTurnChannel.js";
import type { FramingMode } from "../avatar-vrm/domain/vrmLoader.js";
import { useSharedInactivityDoze, useInactivityStore, recordSharedActivity, setSharedAsleep } from "../experiencia/inactivityStore.js";
import { resolveAvatar } from "../experiencia/kiraState.js";
import { QA_ANIMATIONS } from "../experiencia/KiraCover.js";
import { useT } from "../../i18n/t.js";
import { cn } from "../../lib/cn.js";
import {
  COMMAND_PALETTE_LISTBOX_ID,
  CommandPalettePopover,
  ComposerCommandPanel,
} from "../commands/ComposerCommandPanel.js";
import { matchCommands } from "../commands/registry.js";
import { useTheme } from "../../theme/useTheme.js";
import { PlaybackProvider } from "../../state/PlaybackProvider.js";
// Look button hidden (see below); kept for re-enabling.
// import { DesktopVisionLookButton } from "./DesktopVisionLook.js";
import "./desktop.css";

const ZOOM_STORAGE_KEY = "oc-desktop-companion-zoom";

function DesktopCompanionContent() {
  useTheme();
  const t = useT();
  const [snapshot, setSnapshot] = useState<DesktopSnapshot | null>(null);
  const [bootstrapError, setBootstrapError] = useState<string | null>(null);
  const [showControls, setShowControls] = useState(false);
  const [draft, setDraft] = useState("");
  const [sendError, setSendError] = useState<string | null>(null);
  const [visionCommandBlocked, setVisionCommandBlocked] = useState(false);
  const [vrmStageError, setVrmStageError] = useState<string | null>(null);
  const [framingMode, setFramingMode] = useState<FramingMode>(() => {
    try {
      const saved = localStorage.getItem(ZOOM_STORAGE_KEY);
      if (saved === "full" || saved === "half" || saved === "head") return saved;
    } catch {}
    return "full";
  });

  const [isQaRunning, setIsQaRunning] = useState(false);
  const [qaIndex, setQaIndex] = useState(0);
  const qaAnimationUrl = isQaRunning ? QA_ANIMATIONS[qaIndex].url : null;

  const qaStep = useMemo(
    () => ({
      valid: true,
      completed: false,
      timer: undefined as ReturnType<typeof setTimeout> | undefined,
    }),
    [isQaRunning, qaIndex, snapshot?.model]
  );

  useEffect(() => {
    qaStep.valid = true;
    return () => {
      qaStep.valid = false;
      clearTimeout(qaStep.timer);
    };
  }, [qaStep]);

  const handleQaAnimationFinished = useCallback(() => {
    if (!isQaRunning || !qaStep.valid || qaStep.completed) return;
    qaStep.completed = true;
    qaStep.timer = setTimeout(() => {
      if (!qaStep.valid) return;
      if (qaIndex < QA_ANIMATIONS.length - 1) {
        setQaIndex(qaIndex + 1);
      } else {
        setIsQaRunning(false);
        setQaIndex(0);
      }
    }, 200);
  }, [isQaRunning, qaIndex, qaStep]);

  const [launcherCommandId, setLauncherCommandId] = useState<string | null>(null);
  const [activeDescendant, setActiveDescendant] = useState<string | null>(null);
  const controlsRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const showCommandPanel = isComposerCommandPrefix(draft);
  const launcherOpen = showCommandPanel && launcherCommandId === null;
  const commandListboxOpen = launcherOpen && matchCommands(draft).length > 0;

  function focusInput() {
    inputRef.current?.focus();
  }

  function closeLauncherCommand() {
    setLauncherCommandId(null);
    focusInput();
  }

  const handleSetZoom = (mode: FramingMode) => {
    setFramingMode(mode);
    try {
      localStorage.setItem(ZOOM_STORAGE_KEY, mode);
    } catch {}
  };

  const pointerOriginRef = useRef<{ x: number; y: number } | null>(null);
  const hasDraggedRef = useRef(false);
  // Timestamp of the latest pointer interaction; see blurGrace.ts.
  const lastInteractionRef = useRef<number | null>(null);

  const { data: statusData } = useStatusQuery();
  // Separate webview: it has no EventBridge, so it polls the same event log as
  // the main window and drives the look pose from the same vision events.
  useServerEventLog();
  const looking = useVisionPhaseStore((s) => isVisionActivePhase(s.phase));
  // ptt-dictation-20261111: a hold made here counts as background, so in the
  // `foreground` dictation mode it keeps sending (this window never takes
  // focus, and the main window may still report focused). It never inserts
  // text: this webview has no composer hook and no focus reporter.
  const ptt = usePttHold({ origin: "companion" });
  const { data: visionData } = useVisionQuery();
  const lookNow = useLookNow();
  const { send: sendChatTurn, pending: isSending } = useSendChatTurn();
  const isSubmitting = isSending || lookNow.isPending;

  const recordActivity = useInactivityStore((s) => s.recordActivity);
  const busy = ptt.state === "listening" || Boolean(statusData?.is_speaking || statusData?.is_processing);
  const asleep = useSharedInactivityDoze(busy);

  const { state: avatarState } = resolveAvatar(statusData, {
    livePtt: ptt.state === "listening",
    liveSpeaking: Boolean(statusData?.is_speaking),
    asleep,
  });

  // Bootstrap backend & subscribe to desktop snapshot
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let disposed = false;

    bootstrapBackend()
      .then((res) => {
        if (res.backendError) {
          setBootstrapError(res.backendError);
        }
      })
      .catch(() => {
        setBootstrapError("bootstrap_failed");
      });

    onDesktopState((next) => {
      setSnapshot(next);
    })
      .then((fn) => {
        // The subscription can resolve after unmount; release it right away.
        if (disposed) fn();
        else unlisten = fn;
      })
      .catch(() => {});

    getDesktopState()
      .then((initial) => {
        setSnapshot(initial);
      })
      .catch(() => {});

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  // When model is ready and bootstrap completes, notify desktopReady
  useEffect(() => {
    if (snapshot && !snapshot.ready && snapshot.model) {
      desktopReady(snapshot.generation).catch(() => {});
    }
  }, [snapshot?.generation, snapshot?.ready, snapshot?.model]);

  // When controls strip is revealed, focus the input
  useEffect(() => {
    if (showControls) {
      focusInput();
    } else {
      setLauncherCommandId(null);
      setVisionCommandBlocked(false);
    }
  }, [showControls]);

  // Conceal controls on blur or window hide
  useEffect(() => {
    const handleBlur = () => {
      if (!shouldCollapseOnBlur(Date.now(), lastInteractionRef.current)) return;
      setShowControls(false);
      setLauncherCommandId(null);
      ptt.stop();
    };
    const handleVisibility = () => {
      if (document.hidden) {
        setShowControls(false);
        setLauncherCommandId(null);
        ptt.stop();
      }
    };
    window.addEventListener("blur", handleBlur);
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      window.removeEventListener("blur", handleBlur);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [ptt]);

  // Conceal controls when snapshot becomes hidden
  useEffect(() => {
    if (snapshot && !snapshot.visible) {
      setShowControls(false);
      setLauncherCommandId(null);
      ptt.stop();
    }
  }, [snapshot?.visible, ptt]);

  // Gesture handling on avatar surface
  const handlePointerDown = (e: React.PointerEvent) => {
    recordActivity();
    lastInteractionRef.current = Date.now();
    if (e.button !== 0) return;
    pointerOriginRef.current = { x: e.clientX, y: e.clientY };
    hasDraggedRef.current = false;
    if (typeof e.currentTarget.setPointerCapture === "function") {
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        // Ignore in environments without pointer capture support
      }
    }
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!pointerOriginRef.current || hasDraggedRef.current) return;
    const dx = e.clientX - pointerOriginRef.current.x;
    const dy = e.clientY - pointerOriginRef.current.y;
    const kind: GestureKind = gestureKind(dx, dy, false);
    if (kind === "drag") {
      hasDraggedRef.current = true;
      import("@tauri-apps/api/window")
        .then(({ getCurrentWindow }) => getCurrentWindow().startDragging())
        .catch(() => {});
    }
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    if (!pointerOriginRef.current) return;
    const dx = e.clientX - pointerOriginRef.current.x;
    const dy = e.clientY - pointerOriginRef.current.y;
    pointerOriginRef.current = null;
    if (typeof e.currentTarget.releasePointerCapture === "function") {
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch {
        // Ignore if capture was already released
      }
    }

    if (!hasDraggedRef.current && gestureKind(dx, dy, false) === "click") {
      lastInteractionRef.current = Date.now();
      setShowControls((prev) => {
        if (prev) {
          setLauncherCommandId(null);
          ptt.stop();
        }
        return !prev;
      });
    }
    hasDraggedRef.current = false;
  };

  const handlePointerCancel = (e: React.PointerEvent) => {
    pointerOriginRef.current = null;
    hasDraggedRef.current = false;
    if (typeof e.currentTarget.releasePointerCapture === "function") {
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch {
        // Ignore
      }
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      if (isQaRunning) {
        setIsQaRunning(false);
        return;
      }
      if (launcherCommandId !== null) {
        closeLauncherCommand();
        return;
      }
      if (launcherOpen) {
        setDraft("");
        focusInput();
        return;
      }
      setShowControls(false);
      ptt.stop();
    }
  };

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    recordActivity();
    const trimmed = draft.trim();
    if (!trimmed || isSubmitting) return;
    if (showCommandPanel) return;

    setSendError(null);
    setVisionCommandBlocked(false);

    let text = trimmed;
    const visionCommand = parseVisionCommand(trimmed);
    if (visionCommand) {
      const result = await executeVisionCommand(visionCommand, {
        visionData,
        armLook: (mode) => lookNow.mutateAsync(mode),
      });
      if (!result.ok) {
        setVisionCommandBlocked(true);
        return;
      }
      if (!result.rest) {
        setDraft("");
        return;
      }
      text = result.rest;
    }

    const turn = { type: "operator-turn-accepted" as const, id: crypto.randomUUID(), text, ts: Date.now() };
    try {
      await sendChatTurn(text);
      publishAcceptedCompanionTurn(turn);
      setDraft("");
    } catch {
      setSendError(t("experiencia.desktop.controls.send.error"));
    }
  };

  const micLabel =
    ptt.state === "connecting"
      ? t("experiencia.desktop.controls.mic.connecting")
      : ptt.state === "listening"
      ? t("experiencia.desktop.controls.mic.listening")
      : ptt.state === "flushing"
      ? t("experiencia.desktop.controls.mic.flushing")
      : t("experiencia.desktop.controls.mic.idle");

  // Resolve VRM model URL
  let vrmUrl = "";
  if (snapshot?.model) {
    try {
      vrmUrl = new VrmApi(localBackend(getApiBaseUrl())).modelUrl(snapshot.model);
    } catch {
      vrmUrl = "";
    }
  }

  const sync = useRef<VrmLipSync>();
  const sample = useCallback((frameId?: number, deltaSeconds?: number) => sync.current?.sample(frameId, deltaSeconds) ?? 0, []);
  const isAudioActive = useCallback(() => sync.current?.isAudioActive() ?? false, []);

  // Audio lipsync pipeline for desktop companion
  useEffect(() => {
    if (!snapshot?.visible || !snapshot?.model) {
      sync.current?.dispose();
      sync.current = undefined;
      return;
    }
    let ctx: AudioContext | undefined;
    try {
      const AudioContextClass =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (AudioContextClass) {
        ctx = new AudioContextClass();
      }
    } catch {
      return;
    }

    if (!ctx) return;

    let api: VrmApi;
    try {
      const loopbackBase = localBackend(getApiBaseUrl());
      api = new VrmApi(
        loopbackBase,
        () => extractBearerToken(getAuthHeaders().Authorization),
        async () => {
          await bootstrapApiToken();
          return extractBearerToken(getAuthHeaders().Authorization) || null;
        },
      );
    } catch {
      if (ctx && ctx.state !== "closed") {
        void ctx.close().catch(() => {});
      }
      return;
    }

    const managed = startManagedVrmLipSync({ api, context: ctx, surface: "desktop-companion" });
    sync.current = managed.pipeline;

    return () => {
      managed.dispose();
      sync.current = undefined;
    };
  }, [snapshot?.visible, snapshot?.model]);

  return (
    <div
      className="desktop-companion"
      tabIndex={-1}
      onKeyDown={handleKeyDown}
    >
      <div
        className="desktop-avatar"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerCancel}
      >
        {vrmUrl && !vrmStageError ? (
          <VrmStage
            url={vrmUrl}
            sample={sample}
            diagnosticSurface="desktop-companion"
            isAudioActive={isAudioActive}
            onError={setVrmStageError}
            state={avatarState}
            looking={looking}
            active={snapshot?.visible ?? false}
            framingMode={framingMode}
            qaAnimationUrl={qaAnimationUrl}
            onQaAnimationFinished={handleQaAnimationFinished}
          />
        ) : null}
      </div>

      {/* Active QA HUD badge */}
      {isQaRunning && (
        <div
          className="desktop-qa-hud absolute top-2 inset-x-2 z-40 flex items-center justify-between gap-2 rounded-xl border border-amber-500/50 bg-card/95 px-3 py-1.5 shadow-2xl backdrop-blur-md"
          data-no-drag="true"
        >
          <div className="flex items-center gap-2 min-w-0">
            <span className="flex h-2 w-2 shrink-0 rounded-full bg-amber-400 animate-ping" />
            <div className="flex flex-col text-left min-w-0">
              <span className="text-[9.5px] uppercase font-bold tracking-wider text-amber-400 truncate">
                QA ({qaIndex + 1}/{QA_ANIMATIONS.length})
              </span>
              <span className="text-xs font-semibold text-foreground truncate">
                {QA_ANIMATIONS[qaIndex].label}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-0.5 shrink-0 border-l border-border/60 pl-1.5">
            <button
              type="button"
              disabled={qaIndex === 0}
              onClick={() => setQaIndex((i) => Math.max(0, i - 1))}
              className="p-1 text-muted-foreground hover:text-foreground disabled:opacity-30 rounded hover:bg-surface-2"
              title="Anterior"
            >
              <SkipBack className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              disabled={qaIndex === QA_ANIMATIONS.length - 1}
              onClick={() => setQaIndex((i) => Math.min(QA_ANIMATIONS.length - 1, i + 1))}
              className="p-1 text-muted-foreground hover:text-foreground disabled:opacity-30 rounded hover:bg-surface-2"
              title="Siguiente"
            >
              <SkipForward className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={() => setIsQaRunning(false)}
              className="p-1 text-red-400 hover:text-red-300 rounded hover:bg-surface-2 ml-0.5"
              title="Cerrar QA"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      )}

      {showControls && (
        <div
          ref={controlsRef}
          className="desktop-controls absolute inset-x-2 bottom-2 z-30 flex flex-col gap-2 rounded-xl border border-border/80 bg-card/95 p-2.5 shadow-panel backdrop-blur-md"
          data-no-drag="true"
        >
          {/* Emergent command launcher popover */}
          {launcherOpen && (
            <CommandPalettePopover
              query={draft}
              composerRef={controlsRef}
              onActiveDescendantChange={setActiveDescendant}
              onSelect={(id) => {
                setLauncherCommandId(id);
                setDraft("");
              }}
              onClose={() => {
                setDraft("");
                focusInput();
              }}
            />
          )}

          {/* Floating command stepper dialog */}
          {launcherCommandId !== null && (
            <ComposerCommandPanel
              query=""
              activeId={launcherCommandId}
              onActiveIdChange={(id) => (id === null ? closeLauncherCommand() : setLauncherCommandId(id))}
              onClose={closeLauncherCommand}
            />
          )}

          {/* Zoom / Framing selector & QA Runner */}
          <div className="flex items-center justify-between gap-1 pb-1.5 border-b border-border-soft">
            <div className="flex items-center gap-1.5">
              <span className="mono text-[10.5px] font-semibold uppercase tracking-[0.09em] text-foreground/80 pl-1">
                {t("experiencia.desktop.controls.zoom.label")}
              </span>
              {/* Internal VRM animation QA runner, hidden from users (kept for VRM testing).
              <button
                type="button"
                onClick={() => {
                  if (isQaRunning) {
                    setIsQaRunning(false);
                  } else {
                    recordActivity();
                    setQaIndex(0);
                    setIsQaRunning(true);
                  }
                }}
                className={cn(
                  "flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-medium transition-colors",
                  isQaRunning
                    ? "border border-amber-500/40 bg-amber-500/20 text-amber-300 animate-pulse"
                    : "border border-border-soft bg-surface-2 text-muted-foreground hover:bg-card hover:text-foreground"
                )}
                title="Probar todas las animaciones secuencialmente (QA)"
              >
                {isQaRunning ? (
                  <>
                    <Square className="h-3 w-3 fill-current" />
                    <span>QA</span>
                  </>
                ) : (
                  <>
                    <Play className="h-3 w-3 fill-current" />
                    <span>QA</span>
                  </>
                )}
              </button>
              */}
            </div>
            <div className="flex items-center gap-1 rounded-lg border border-border-soft bg-surface-2 p-0.5">
              <button
                type="button"
                onClick={() => handleSetZoom("full")}
                aria-pressed={framingMode === "full"}
                title={t("experiencia.desktop.controls.zoom.full")}
                className={cn(
                  "rounded-md px-2.5 py-0.5 text-[11px] transition-colors duration-fast",
                  framingMode === "full"
                    ? "bg-primary font-semibold text-primary-foreground shadow-xs"
                    : "font-medium text-foreground/75 hover:bg-card hover:text-foreground"
                )}
              >
                {t("experiencia.desktop.controls.zoom.full_short")}
              </button>
              <button
                type="button"
                onClick={() => handleSetZoom("half")}
                aria-pressed={framingMode === "half"}
                title={t("experiencia.desktop.controls.zoom.half")}
                className={cn(
                  "rounded-md px-2.5 py-0.5 text-[11px] transition-colors duration-fast",
                  framingMode === "half"
                    ? "bg-primary font-semibold text-primary-foreground shadow-xs"
                    : "font-medium text-foreground/75 hover:bg-card hover:text-foreground"
                )}
              >
                {t("experiencia.desktop.controls.zoom.half_short")}
              </button>
              <button
                type="button"
                onClick={() => handleSetZoom("head")}
                aria-pressed={framingMode === "head"}
                title={t("experiencia.desktop.controls.zoom.head")}
                className={cn(
                  "rounded-md px-2.5 py-0.5 text-[11px] transition-colors duration-fast",
                  framingMode === "head"
                    ? "bg-primary font-semibold text-primary-foreground shadow-xs"
                    : "font-medium text-foreground/75 hover:bg-card hover:text-foreground"
                )}
              >
                {t("experiencia.desktop.controls.zoom.head_short")}
              </button>
            </div>
          </div>

          {(bootstrapError || sendError || vrmStageError) && (
            <div
              role="alert"
              className="flex items-center gap-1.5 rounded-lg border border-danger-bd bg-danger-bg px-2.5 py-1 text-xs font-medium text-danger"
            >
              <AlertCircle size={13} className="shrink-0" />
              <span className="truncate">{sendError || bootstrapError || vrmStageError}</span>
            </div>
          )}

          {visionCommandBlocked && (
            <div
              role="alert"
              className="flex items-start gap-1.5 rounded-lg border border-warn-bd bg-warn-bg px-2.5 py-1 text-[11px] font-medium text-warn"
            >
              <AlertCircle size={13} className="mt-0.5 shrink-0" />
              <span>{t("experiencia.vision.command.notReady")}</span>
            </div>
          )}

          {/* Look button hidden: spoken phrases ("mira esto") and /mira already trigger a look (es/en).
          <div className="flex w-full items-center">
            <DesktopVisionLookButton />
          </div>
          */}

          <form onSubmit={handleSend} className="w-full">
            <div className="flex items-stretch overflow-hidden rounded-lg border border-border-soft bg-surface-2 transition-colors duration-fast ease-io focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-ring">
              <input
                ref={inputRef}
                id="desktop-composer-input"
                type="text"
                value={draft}
                onChange={(e) => {
                  setVisionCommandBlocked(false);
                  setDraft(e.target.value);
                  recordActivity();
                }}
                placeholder={t("experiencia.desktop.controls.input.placeholder")}
                aria-label={t("experiencia.desktop.controls.input.aria")}
                disabled={isSubmitting}
                aria-expanded={commandListboxOpen}
                aria-controls={commandListboxOpen ? COMMAND_PALETTE_LISTBOX_ID : undefined}
                aria-activedescendant={commandListboxOpen ? (activeDescendant ?? undefined) : undefined}
                className="h-9 min-w-0 flex-1 bg-transparent px-3 text-xs text-foreground placeholder:text-dim focus:outline-none"
              />
              <div className="flex items-stretch border-l border-border/40">
                <button
                  type="button"
                  aria-label={micLabel}
                  aria-pressed={ptt.state === "listening"}
                  title={micLabel}
                  onPointerDown={(e) => {
                    recordActivity();
                    if (statusData?.llm_generating || statusData?.is_speaking) return;
                    if (typeof e.currentTarget.setPointerCapture === "function") {
                      try {
                        e.currentTarget.setPointerCapture(e.pointerId);
                      } catch {}
                    }
                    ptt.start();
                  }}
                  onPointerUp={(e) => {
                    if (typeof e.currentTarget.releasePointerCapture === "function") {
                      try {
                        e.currentTarget.releasePointerCapture(e.pointerId);
                      } catch {}
                    }
                    ptt.stop();
                  }}
                  onPointerCancel={() => ptt.stop()}
                  onLostPointerCapture={() => ptt.stop()}
                  onPointerLeave={(e) => {
                    if (e.buttons === 0) ptt.stop();
                  }}
                  onKeyDown={(e) => {
                    if (e.key === " " || e.key === "Enter") {
                      e.preventDefault();
                      if (!statusData?.llm_generating && !statusData?.is_speaking) {
                        ptt.start();
                      }
                    }
                  }}
                  onKeyUp={(e) => {
                    if (e.key === " " || e.key === "Enter") {
                      e.preventDefault();
                      ptt.stop();
                    }
                  }}
                  className={cn(
                    "flex h-9 w-9 shrink-0 items-center justify-center transition-colors duration-fast",
                    "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                    ptt.state === "idle" && "text-muted-foreground hover:bg-surface-2/60 hover:text-foreground",
                    ptt.state === "connecting" && "bg-info-bg text-info animate-pulse",
                    ptt.state === "listening" && "bg-danger text-danger-foreground animate-pulse",
                    ptt.state === "flushing" && "bg-surface-2 text-muted-foreground animate-pulse"
                  )}
                >
                  <Mic size={14} />
                </button>
                <button
                  type="submit"
                  disabled={!draft.trim() || isSubmitting || showCommandPanel}
                  aria-label={t("experiencia.desktop.controls.send.action")}
                  title={t("experiencia.desktop.controls.send.action")}
                  className="flex h-9 items-center px-3.5 text-xs font-semibold bg-[image:var(--accent-grad)] text-[var(--accent-contrast)] transition-opacity hover:opacity-90 disabled:opacity-40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                >
                  <Send size={12} className="mr-1" />
                  <span>{t("experiencia.desktop.controls.send.action")}</span>
                </button>
              </div>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

export function DesktopCompanion() {
  return (
    <PlaybackProvider mode="client">
      <DesktopCompanionContent />
    </PlaybackProvider>
  );
}
