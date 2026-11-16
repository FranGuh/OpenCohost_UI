import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useStatusQuery } from "../../api/status.js";
import { useVisionLooking } from "../../api/vision.js";
import { useAvatarConfigQuery, avatarImageUrl } from "../../api/avatar.js";
import { useAvatarImageVersion } from "../../store/avatarImageVersion.js";
import { useAvatarLiveState } from "../../store/avatarLiveStore.js";
import { useAvatarPresentationStore } from "../../store/avatarPresentationStore.js";
import { VrmStage } from "../avatar-vrm/components/VrmStage.js";
import { VrmApi, localBackend } from "../avatar-vrm/domain/vrmApi.js";
import type { VrmLipSync } from "../avatar-vrm/domain/vrmLipSync.js";
import { extractBearerToken, startManagedVrmLipSync } from "../avatar-vrm/domain/vrmLipSyncLifecycle.js";
import { bootstrapApiToken, getApiBaseUrl, getAuthHeaders } from "../../api/client.js";
import { t, useT } from "../../i18n/t.js";
import { AVATAR_IMAGE, FALLBACK_AVATAR, deriveAvatarState, resolveAvatar } from "./kiraState.js";

/**
 * F4 fix (runtime_findings_batch_20260731 1.3): the identity row used to
 * hardcode the literal "co-host local" — a lie the moment a cloud provider
 * (or an active fallback) was in play. Derived from the backend's LIVE
 * provider/transport truth (StatusResponse.transport/.fallback_active),
 * never guessed client-side. Undefined fields (older backend / not loaded
 * yet) degrade to the historical "co-host local" text.
 */
function coHostLabel(data: { transport?: string; fallback_active?: boolean } | undefined): string {
  if (data?.transport === "cloud") return t("experiencia.kiraCover.identity.coHost.cloud");
  if (data?.fallback_active) return t("experiencia.kiraCover.identity.coHost.localFallback");
  return t("experiencia.kiraCover.identity.coHost.local");
}

/**
 * Unit 2.5 (runtime_findings_batch_20260731 F13): session-level mode above
 * AgendaState.OFF, DERIVED backend-side (StatusResponse.session_mode) — never
 * re-derived here. Undefined (older backend / not loaded yet) renders nothing,
 * same degrade-quietly convention as the rest of this identity row.
 */
function sessionModeLabel(mode: string | undefined): string | null {
  if (mode === "agenda") return t("experiencia.kiraCover.identity.sessionMode.agenda");
  if (mode === "post-agenda") return t("experiencia.kiraCover.identity.sessionMode.postAgenda");
  if (mode === "inactiva") return t("experiencia.kiraCover.identity.sessionMode.inactiva");
  return null;
}

// Trust the live speaking edge only while fresh; past this the 2s status poll
// has certainly caught up, so a missed speaking_end can't pin "speaking".
const LIVE_SPEAKING_FRESH_MS = 3000;

// Same idea for an open PTT hold, but here the stamp is a real HEARTBEAT: the
// 1Hz keepalive and the 1Hz server poll both re-stamp it while the mic is live
// (avatarLiveStore.setListening), so three missed beats means the session is
// gone — which is precisely when the server's own keepalive watchdog kills it.
// Unlike `speaking`, there is no status-poll fallback to catch a lost release:
// the backend's avatar_state cannot express "listening" at all.
const LIVE_PTT_FRESH_MS = 3000;

import { SkipForward, SkipBack, X } from "lucide-react";
import { useStageControlsStore } from "../../store/stageControlsStore.js";
import { SLEEP_AFTER_IDLE_MS, useSharedInactivityDoze } from "./inactivityStore.js";
export { SLEEP_AFTER_IDLE_MS };

/** Re-read document.hidden this often while the stage believes it is hidden. */
const DOC_HIDDEN_RECHECK_MS = 2000;

export const QA_ANIMATIONS: { name: string; url: string; label: string }[] = [
  { name: "idle", url: "/animations/idle.vrma", label: "01. Base Idle" },
  { name: "VRMA_01", url: "/animations/VRMA_01.vrma", label: "02. Saludo / Wave (VRMA_01)" },
  { name: "VRMA_02", url: "/animations/VRMA_02.vrma", label: "03. Reverencia / Bow (VRMA_02)" },
  { name: "VRMA_03", url: "/animations/VRMA_03.vrma", label: "04. Victoria / Peace (VRMA_03)" },
  { name: "VRMA_04", url: "/animations/VRMA_04.vrma", label: "05. Pistola / Shoot (VRMA_04)" },
  { name: "VRMA_05", url: "/animations/VRMA_05.vrma", label: "06. Alegría / Joy (VRMA_05)" },
  { name: "VRMA_06", url: "/animations/VRMA_06.vrma", label: "07. Pose 06 (VRMA_06)" },
  { name: "VRMA_07", url: "/animations/VRMA_07.vrma", label: "08. Pose 07 (VRMA_07)" },
  { name: "001_motion_pose", url: "/animations/001_motion_pose.vrma", label: "09. Motion Pose" },
  { name: "002_dogeza", url: "/animations/002_dogeza.vrma", label: "10. Dogeza Prostration" },
  { name: "003_humidai", url: "/animations/003_humidai.vrma", label: "11. Humidai Step" },
  { name: "004_hello_1", url: "/animations/004_hello_1.vrma", label: "12. Hello 1 Wave" },
  { name: "005_smartphone", url: "/animations/005_smartphone.vrma", label: "13. Mirar Smartphone" },
  { name: "006_drinkwater", url: "/animations/006_drinkwater.vrma", label: "14. Beber Agua" },
  { name: "007_gekirei", url: "/animations/007_gekirei.vrma", label: "15. Ánimo / Gekirei" },
  { name: "008_gatan", url: "/animations/008_gatan.vrma", label: "16. Gatan" },
];

/** CTK parity: `motor_event_handlers.py::tick_speaking_alt` reschedules at 700ms. */
export const SPEAKING_ALT_MS = 700;

/** The 700ms SPEAKING <-> SPEAKING_ALT flip-flop CTK runs while Kira talks
 * (`start_speaking_alt_timer`), so her mouth/pose actually moves. */
function useSpeakingAlt(speaking: boolean): boolean {
  const [alt, setAlt] = useState(false);
  useEffect(() => {
    if (!speaking) {
      setAlt(false);
      return;
    }
    const timer = setInterval(() => setAlt((current) => !current), SPEAKING_ALT_MS);
    return () => clearInterval(timer);
  }, [speaking]);
  return alt;
}

/**
 * Kira's main presence view — the brand ring/aperture framing her avatar with
 * an ambient glow, status badge, and identity row.
 *
 * The outer ring is overflow-hidden + rounded-full, clipping the image to a
 * perfect circle. A linear gradient overlay at the bottom fades the lower body
 * away instead of a hard crop — the gradient is itself clipped to the circle
 * by the parent overflow-hidden. The inner ring carries the --focus glow with
 * a breathing pulse (guarded behind prefers-reduced-motion).
 */
export function KiraCover() {
  // Framing + animation-test state is shared with the title bar controls.
  const isQaRunning = useStageControlsStore((s) => s.qaRunning);
  const qaIndex = useStageControlsStore((s) => s.qaIndex);
  const framingMode = useStageControlsStore((s) => s.framingMode);
  const { stopQa, setQaIndex, setStage3dMounted } = useStageControlsStore.getState();
  const qaAnimationUrl = isQaRunning ? QA_ANIMATIONS[qaIndex].url : null;
  const looking = useVisionLooking();

  const t = useT();
  const { data } = useStatusQuery();
  const liveSpeaking = useAvatarLiveState((s) => s.speaking);
  const liveEventTs = useAvatarLiveState((s) => s.lastEventTs);
  const livePtt = useAvatarLiveState((s) => s.listening);
  const livePttTs = useAvatarLiveState((s) => s.lastPttTs);

  // Trust either live signal only while fresh; on false (or a stale edge) fall
  // straight back to the poll-derived state.
  const now = Date.now();
  const freshSpeaking = liveSpeaking && now - liveEventTs < LIVE_SPEAKING_FRESH_MS;
  const freshPtt = livePtt && now - livePttTs < LIVE_PTT_FRESH_MS;

  const polled = deriveAvatarState(data);
  const speaking = freshSpeaking || polled === "speaking";
  const alt = useSpeakingAlt(speaking);
  // CTK resets its inactivity timer on listening/processing/idle pipeline states
  // (app_shell.py:1798-1800). "busy" is the same idea: anything happening right
  // now. A cold engine ("sleeping" from the poll) is NOT activity — otherwise
  // the countdown would never even start.
  const busy = isQaRunning || freshPtt || speaking || (polled !== "idle" && polled !== "sleeping");
  const asleep = useSharedInactivityDoze(busy, Math.max(liveEventTs, livePttTs));

  const { state: avatarState, label: avatarLabel } = resolveAvatar(data, {
    livePtt: freshPtt,
    liveSpeaking: freshSpeaking,
    asleep,
    alt
  });
  // User-uploaded art (tauri_avatar_upload_20260911): when the backend config
  // maps this state to an uploaded file, paint the served bytes; otherwise the
  // static default. Two-level error fallback: custom → static → kira-error.
  const { data: avatarCfg } = useAvatarConfigQuery();
  // Content version busts the served URL after a same-state re-upload (which
  // otherwise yields the identical string) and resets the error fallback so
  // fresh bytes repaint even from a parked static fallback.
  const imgVersions = useAvatarImageVersion((s) => s.versions);
  const imgVersion = imgVersions[avatarState] ?? 0;
  const customUrl = avatarCfg?.state_images[avatarState]
    ? avatarImageUrl(avatarState, imgVersion)
    : undefined;
  const candidates = customUrl
    ? [customUrl, AVATAR_IMAGE[avatarState], FALLBACK_AVATAR]
    : [AVATAR_IMAGE[avatarState], FALLBACK_AVATAR];
  const [errorCount, setErrorCount] = useState(0);
  useEffect(() => {
    setErrorCount(0);
  }, [avatarState, customUrl]);
  const avatarSrc = candidates[Math.min(errorCount, candidates.length - 1)];

  // Preload both speaking frames so the 700ms mouth-flap never flashes blank.
  useEffect(() => {
    if (!avatarCfg) return;
    for (const state of ["speaking", "speaking_alt"] as const) {
      if (avatarCfg.state_images[state]) {
        const preload = new Image();
        preload.src = avatarImageUrl(state, imgVersions[state] ?? 0);
      }
    }
  }, [avatarCfg, imgVersions]);

  const presentationMode = useAvatarPresentationStore((s) => s.mode);
  const selectedModel = useAvatarPresentationStore((s) => s.selectedModel);
  const sync = useRef<VrmLipSync>();
  const sample = useCallback((frameId?: number, deltaSeconds?: number) => sync.current?.sample(frameId, deltaSeconds) ?? 0, []);
  const isAudioActive = useCallback(() => sync.current?.isAudioActive() ?? false, []);
  const [vrmStageError, setVrmStageError] = useState<string | null>(null);

  const qaStep = useMemo(() => ({ valid: true, completed: false,
    timer: undefined as ReturnType<typeof setTimeout> | undefined }),
    [isQaRunning, qaIndex, selectedModel, presentationMode]);
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
      if (qaIndex < QA_ANIMATIONS.length - 1) setQaIndex(qaIndex + 1);
      else { stopQa(); setQaIndex(0); }
    }, 200);
  }, [isQaRunning, qaIndex, qaStep]);

  const [desktopSnapshot, setDesktopSnapshot] = useState<{ enabled: boolean; visible: boolean } | null>(null);
  const [isDocHidden, setIsDocHidden] = useState(() => typeof document !== "undefined" ? document.hidden : false);

  useEffect(() => {
    // Always re-read document.hidden instead of trusting which event fired, and listen
    // on every "page is back" signal: a missed event must not freeze the stage inactive.
    const onVisChange = () => setIsDocHidden(document.hidden);
    document.addEventListener("visibilitychange", onVisChange);
    window.addEventListener("focus", onVisChange);
    window.addEventListener("pageshow", onVisChange);
    let unlisten: (() => void) | undefined;
    import("../desktop-companion/desktopClient.js")
      .then(({ onDesktopState, getDesktopState }) => {
        onDesktopState(setDesktopSnapshot).then((fn) => { unlisten = fn; }).catch(() => {});
        getDesktopState().then(setDesktopSnapshot).catch(() => {});
      })
      .catch(() => {});

    return () => {
      document.removeEventListener("visibilitychange", onVisChange);
      window.removeEventListener("focus", onVisChange);
      window.removeEventListener("pageshow", onVisChange);
      unlisten?.();
    };
  }, []);

  // Backstop while (believed) hidden: a cheap periodic re-read of document.hidden, so the
  // stage self-heals even if every visibility event was missed. Not armed while visible.
  useEffect(() => {
    if (!isDocHidden) return;
    const recheck = setInterval(() => {
      if (!document.hidden) setIsDocHidden(false);
    }, DOC_HIDDEN_RECHECK_MS);
    return () => clearInterval(recheck);
  }, [isDocHidden]);

  const isCompanionActive = Boolean(desktopSnapshot?.enabled && desktopSnapshot?.visible);
  const presentationActive = !isDocHidden && !isCompanionActive;

  // Transient WebGL context loss while minimized must not kill the 3D stage
  const isFatalVrmError = Boolean(
    vrmStageError && !vrmStageError.includes("WebGL context lost")
  );

  useEffect(() => {
    setVrmStageError(null);
  }, [presentationMode, selectedModel]);

  useEffect(() => {
    if (presentationActive) {
      setVrmStageError(null);
    }
  }, [presentationActive]);

  useEffect(() => {
    if (presentationMode !== "3d" || !selectedModel || isFatalVrmError || !presentationActive) {
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
      // AudioContext unavailable in current environment; 3D still renders with sample() = 0
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

    const managed = startManagedVrmLipSync({ api, context: ctx, surface: "main" });
    sync.current = managed.pipeline;

    return () => {
      managed.dispose();
      sync.current = undefined;
    };
  }, [presentationMode, selectedModel, vrmStageError, presentationActive]);

  let vrmUrl = "";
  if (presentationMode === "3d" && selectedModel) {
    try {
      vrmUrl = new VrmApi(localBackend(getApiBaseUrl())).modelUrl(selectedModel);
    } catch {
      vrmUrl = "";
    }
  }

  // Tell the title bar controls whether the 3D stage is on screen.
  const stage3dMounted = presentationMode === "3d" && Boolean(vrmUrl) && !isFatalVrmError;
  useEffect(() => {
    setStage3dMounted(stage3dMounted);
    return () => setStage3dMounted(false);
  }, [stage3dMounted, setStage3dMounted]);

  return (
    <div className="relative flex h-full flex-row items-center justify-center overflow-hidden">
      {/* Ambient glow centred on the avatar zone */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse 80% 60% at 50% 60%, var(--accent-soft), transparent 68%)"
        }}
      />

      {/* Avatar presentation: 3D expanded stage or 2D circular aperture */}
      {presentationMode === "3d" && vrmUrl && !isFatalVrmError ? (
        <div className="relative z-10 flex-1 w-full h-full min-h-0 flex items-center justify-center overflow-hidden">
          <VrmStage
            url={vrmUrl}
            sample={sample}
            diagnosticSurface="main"
            isAudioActive={isAudioActive}
            onError={setVrmStageError}
            state={avatarState}
            active={presentationActive}
            framingMode={framingMode}
            qaAnimationUrl={qaAnimationUrl}
            looking={looking}
            onQaAnimationFinished={handleQaAnimationFinished}
          />

          {/* Active QA HUD badge */}
          {isQaRunning && (
            <div className="absolute top-4 left-4 z-20 flex items-center gap-3 rounded-full border border-amber-500/50 bg-card/95 px-4 py-2 shadow-2xl backdrop-blur-md">
              <span className="flex h-2.5 w-2.5 rounded-full bg-amber-400 animate-ping" />
              <div className="flex flex-col text-left">
                <span className="text-[10px] uppercase font-bold tracking-wider text-amber-400">
                  Validación QA ({qaIndex + 1}/{QA_ANIMATIONS.length})
                </span>
                <span className="text-sm font-semibold text-foreground">
                  {QA_ANIMATIONS[qaIndex].label}
                </span>
              </div>
              <div className="flex items-center gap-1 pl-2 border-l border-border/60">
                <button
                  type="button"
                  disabled={qaIndex === 0}
                  onClick={() => setQaIndex(Math.max(0, qaIndex - 1))}
                  className="p-1 text-muted-foreground hover:text-foreground disabled:opacity-30 rounded hover:bg-surface-3/50"
                  title="Anterior"
                >
                  <SkipBack className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  disabled={qaIndex === QA_ANIMATIONS.length - 1}
                  onClick={() => setQaIndex(Math.min(QA_ANIMATIONS.length - 1, qaIndex + 1))}
                  className="p-1 text-muted-foreground hover:text-foreground disabled:opacity-30 rounded hover:bg-surface-3/50"
                  title="Siguiente"
                >
                  <SkipForward className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  onClick={stopQa}
                  className="p-1 text-red-400 hover:text-red-300 rounded hover:bg-surface-3/50 ml-1"
                  title="Cerrar QA"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          )}

          {/* Bottom gradient fade to ground the 3D avatar */}
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-0 bottom-0 h-8"
            style={{
              background: "linear-gradient(to top, var(--bg-deep, var(--background)), transparent)"
            }}
          />
        </div>
      ) : (
        <div className="relative z-10 h-[min(620px,72dvh)] w-[min(620px,72dvh)] overflow-hidden rounded-full border border-ring">
          {/* Inner breathing ring */}
          <div
            aria-hidden="true"
            className="absolute inset-3 rounded-full border border-primary animate-pulse motion-reduce:animate-none"
            style={{ boxShadow: "0 0 60px var(--accent-soft)" }}
          />
          <img
            src={avatarSrc}
            onError={() => setErrorCount((count) => count + 1)}
            alt={t("experiencia.kiraCover.avatar.alt", { state: t(avatarLabel) })}
            className="h-full w-full object-contain"
          />
          {/* Bottom gradient fade — clipped to circle, blends the lower body away */}
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-0 bottom-0 h-44"
            style={{
              background: "linear-gradient(to top, var(--bg-deep, var(--background)), transparent)"
            }}
          />
        </div>
      )}

      {/* Identity */}
      {/* No logro aumentarle un padding en x al width para que la caja por los laterales tenga un margen*/}
      <div className="fixed z-10 mt-1 bottom-0 flex flex-col items-center gap-1 text-center w-sm h-sm rounded"
        style={{
          background: "linear-gradient(to top, var(--bg-deep, var(--background)), transparent)"
        }}
      >
        <h1 className="text-3xl font-extrabold tracking-tight text-foreground">{data?.active_profile ?? "No profile"}</h1>
        <p className="mono text-xs text-muted-foreground">
          {coHostLabel(data)} · {data?.current_model ?? t("experiencia.kiraCover.identity.model.loading")}
          {sessionModeLabel(data?.session_mode) && ` · ${sessionModeLabel(data?.session_mode)}`}
        </p>
      </div>
    </div>
  );
}
