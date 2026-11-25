import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from "react";
import { Card } from "../../ui/Card.js";
import { Button } from "../../ui/Button.js";
import { Alert } from "../../ui/Alert.js";
import { Select } from "../../ui/Select.js";
import { Switch } from "../../ui/Switch.js";
import { ExternalLink, Keyboard, Mic, Radio } from "lucide-react";
import { openExternalUrl } from "../../lib/openUrl.js";

export const LIVEAUDIO_DOWNLOAD_URL = "https://liveaudio.opencohost.com/?utm_source=opencohost";
import { cn } from "../../lib/cn.js";
import {
  usePttHold,
  useTestPttConnectionMutation,
  useUpdatePttConfigMutation,
  usePttStateQuery,
  type PttDictationMode,
  type PttGraceMode
} from "../../api/ptt.js";
import { errorCopy, stateCopy } from "../experiencia/pttCopy.js";
import { useLastReply } from "../../api/chat.js";
import { useT, type TKey } from "../../i18n/t.js";

const inputClass =
  "h-9 w-full rounded-md border border-border bg-background px-3 text-sm text-foreground placeholder:text-dim focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-60";

/** Server only accepts ws:// or wss:// (liveaudio_url_config contract) —
 * caught client-side so an obviously wrong scheme never wastes a round trip. */
function isValidWsScheme(url: string): boolean {
  return /^wss?:\/\//i.test(url.trim());
}

/** Text-entry focus (chat box, profile/OBS fields, memoria editing, …) must
 * never be hijacked by the in-app Space/Enter hold shortcut.
 * ponytail: scoped to text-entry elements only, not every focusable widget —
 * tighten to "only when nothing/the PTT button is focused" if a stray
 * Space/Enter on some other button proves noisy in practice. */
function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  return target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT";
}

// GLOBAL SHORTCUT (OS-level hotkey via @tauri-apps/plugin-global-shortcut) is
// DEFERRED to a follow-up track (ptt_global_shortcut) — see design doc
// sdd/liveaudio-ptt-tauri-20260710. It's a four-surface native change (Cargo
// dep, lib.rs registration, capabilities permissions, npm plugin) requiring a
// full Rust rebuild, and cross-app key-up reliability is exactly the failure
// class that forced CTK's guillotine. The in-app hold below delivers 100% of
// the backend value; the shortcut later just calls the same usePttHold
// start/stop — zero backend change. "Mapear atajo" stays disabled.
export const PTT_HOTKEY_OPTIONS = [
  "F1", "F2", "F3", "F4", "F5", "F6",
  "F7", "F8", "F9", "F10", "F11", "F12",
  "Insert", "ScrollLock", "Pause",
  "Mouse4", "Mouse5",
] as const;

/** Dictation mode choices (ptt-dictation-20261111), in display order. */
const DICTATION_MODES: ReadonlyArray<{ value: PttDictationMode; label: TKey }> = [
  { value: "send", label: "controles.ptt.dictation.option.send" },
  { value: "foreground", label: "controles.ptt.dictation.option.foreground" },
  { value: "always", label: "controles.ptt.dictation.option.always" }
];

/** Grace window presets (ptt-live-dictation-20261125), in display order. */
const GRACE_MODES: ReadonlyArray<{ value: PttGraceMode; label: TKey }> = [
  { value: "auto", label: "controles.ptt.grace.option.auto" },
  { value: "fast", label: "controles.ptt.grace.option.fast" },
  { value: "custom", label: "controles.ptt.grace.option.custom" }
];

export function PTTCard() {
  const t = useT();
  const { state, error, start, stop } = usePttHold();
  const lastReply = useLastReply();
  const buttonRef = useRef<HTMLButtonElement>(null);

  // LiveAudio (WhisperLive) URL configuration (liveaudio_url_config track).
  // GET /api/ptt/state already carries the active stt_ws_url — hydrated once
  // below, then re-hydrated whenever the save mutation patches that cache.
  const pttState = usePttStateQuery();
  const updateWsConfig = useUpdatePttConfigMutation();
  const testWsConnection = useTestPttConnectionMutation();
  const [wsUrl, setWsUrl] = useState("");
  // Holds the key, not the resolved message — see the render site below.
  const [schemeError, setSchemeError] = useState<TKey | null>(null);
  const activeWsUrl = pttState.data?.stt_ws_url ?? null;
  const graceMode: PttGraceMode = pttState.data?.grace_mode ?? "auto";
  const savedGraceS = pttState.data?.grace_s;
  const [graceInput, setGraceInput] = useState("");
  useEffect(() => {
    if (savedGraceS != null) setGraceInput(String(savedGraceS));
  }, [savedGraceS]);

  function commitGrace() {
    const value = Number(graceInput);
    if (graceInput.trim() === "" || Number.isNaN(value) || value === savedGraceS) return;
    updateWsConfig.mutate({ grace_s: value });
  }

  useEffect(() => {
    if (activeWsUrl != null) setWsUrl(activeWsUrl);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeWsUrl]);

  function onWsUrlChange(next: string) {
    setSchemeError(null);
    if (updateWsConfig.isError) updateWsConfig.reset();
    if (testWsConnection.isSuccess || testWsConnection.isError) testWsConnection.reset();
    setWsUrl(next);
  }

  function saveWsUrl() {
    const trimmed = wsUrl.trim();
    if (!isValidWsScheme(trimmed)) {
      setSchemeError("controles.ptt.wsUrl.error.scheme");
      return;
    }
    setSchemeError(null);
    updateWsConfig.mutate(trimmed);
  }

  function runWsTest() {
    const trimmed = wsUrl.trim();
    if (!isValidWsScheme(trimmed)) {
      setSchemeError("controles.ptt.wsUrl.error.scheme");
      return;
    }
    setSchemeError(null);
    testWsConnection.mutate(trimmed);
  }
  // Read at render time, not just inside effects/handlers below: react-query
  // v5's "tracked queries" optimization only re-renders this component for
  // properties it saw ACCESSED DURING RENDER — touching `.data` only inside
  // useEffect/handler closures never marks it observed, so a background
  // refetch would update the cache silently without ever notifying us.
  const lastReplyTurnId = lastReply.data?.turn_id;
  const [repliedSinceHold, setRepliedSinceHold] = useState(false);
  const replyBaselineRef = useRef<number | null>(null);

  // A NEW turn_id arriving proves Kira replied to the most recently captured
  // baseline (set in handleStop below, synchronously at release time — not
  // derived from watching for a "flushing" render, which React 18's batching
  // can collapse away entirely on a fast round-trip).
  useEffect(() => {
    const baseline = replyBaselineRef.current;
    if (baseline !== null && lastReplyTurnId !== undefined && lastReplyTurnId > baseline) {
      setRepliedSinceHold(true);
    }
  }, [lastReplyTurnId]);

  // Snapshots the current reply turn_id the INSTANT the operator releases
  // (not when the flush later converges) so a later turn_id proves Kira
  // replied to THIS hold, not a stale one from before PTT was ever pressed.
  // Scoped to an actually-active hold so a stray blur/keyup with nothing
  // held never resets an already-shown "Kira respondió." note.
  function handleStop() {
    if (state === "listening" || state === "connecting") {
      replyBaselineRef.current = lastReplyTurnId ?? 0;
      setRepliedSinceHold(false);
    }
    stop();
  }

  function handlePointerDown(e: ReactPointerEvent<HTMLButtonElement>) {
    e.currentTarget.setPointerCapture?.(e.pointerId); // guarantees the up event even off-button; optional-chained for jsdom, which doesn't implement it
    start();
  }

  function handleKeyDown(e: ReactKeyboardEvent<HTMLButtonElement>) {
    if (e.repeat) return;
    if (e.key !== " " && e.key !== "Enter") return;
    e.preventDefault(); // suppress the button's own native space-triggers-click
    start();
  }

  function handleKeyUp(e: ReactKeyboardEvent<HTMLButtonElement>) {
    if (e.key !== " " && e.key !== "Enter") return;
    handleStop();
  }

  // In-app keyboard hold works from anywhere (not just while the button has
  // focus) and alt-tab (window blur) is a release, same as CTK's guillotine
  // covers a dropped OS key-up. Every missed release here is backstopped by
  // the server's 3s keepalive watchdog regardless.
  // No deps array (re-subscribes every render): handleStop is a plain
  // closure over `state`/`lastReply.data`, not a useCallback — a stale deps
  // array here would freeze onKeyUp/onWindowBlur on the state that existed
  // when the effect first ran. Cheap: 3 listener churns per render.
  useEffect(() => {
    // Only act when nothing is focused (document.body) or the PTT button
    // itself is focused — a focused native control (Switch, other Button,
    // link, checkbox) must keep Space/Enter for its own activation instead
    // of being hijacked into starting a listening session.
    function isEligibleFocus(): boolean {
      return document.activeElement === document.body || document.activeElement === buttonRef.current;
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.repeat || isTypingTarget(e.target)) return;
      if (e.code !== "Space" && e.code !== "Enter") return;
      if (!isEligibleFocus()) return;
      e.preventDefault();
      start();
    }
    function onKeyUp(e: KeyboardEvent) {
      if (e.code !== "Space" && e.code !== "Enter") return;
      if (!isEligibleFocus()) return;
      handleStop();
    }
    function onWindowBlur() {
      handleStop();
    }
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onWindowBlur);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onWindowBlur);
    };
  });

  const listening = state === "listening";
  const note = error
    ? errorCopy(error)
    : repliedSinceHold && state === "idle"
      ? t("controles.ptt.repliedNotice")
      : null;

  return (
    <Card className="flex flex-col p-4">
      <div className="border-b border-border-soft pb-3">
        <h2 className="text-sm font-bold text-foreground">{t("controles.ptt.card.title")}</h2>
      </div>

      <div className="flex flex-col gap-3.5 pt-3.5">
        <p className="text-xs leading-relaxed text-muted-foreground">{t("controles.ptt.hold.hint")}</p>

        <button
          ref={buttonRef}
          type="button"
          aria-pressed={listening}
          aria-label={stateCopy(state)}
          onPointerDown={handlePointerDown}
          onPointerUp={handleStop}
          onPointerCancel={handleStop}
          onLostPointerCapture={handleStop}
          onKeyDown={handleKeyDown}
          onKeyUp={handleKeyUp}
          className={cn(
            "flex h-16 w-full select-none items-center justify-center rounded-xl border text-sm font-semibold transition-colors touch-none",
            "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
            listening
              ? "border-danger-bd bg-danger-bg text-danger animate-pulse motion-reduce:animate-none"
              : "border-border bg-card text-foreground hover:border-primary"
          )}
        >
          {stateCopy(state)}
        </button>

        {note && (
          <p role="status" className={cn("text-xs leading-relaxed", error ? "text-danger" : "text-muted-foreground")}>
            {note}
          </p>
        )}

        <section aria-labelledby="ptt-dictation-label" className="space-y-2">
          <span id="ptt-dictation-label" className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.09em] text-dim">
            <Mic size={14} className="text-muted-foreground" aria-hidden="true" />
            {t("controles.ptt.dictation.eyebrow")}
          </span>
          <Select
            aria-label={t("controles.ptt.dictation.eyebrow")}
            value={pttState.data?.dictation_mode ?? "send"}
            disabled={updateWsConfig.isPending}
            options={DICTATION_MODES.map((mode) => ({ value: mode.value, label: t(mode.label) }))}
            onChange={(mode) => updateWsConfig.mutate({ dictation_mode: mode as PttDictationMode })}
          />
          <p className="text-xs leading-relaxed text-muted-foreground">{t("controles.ptt.dictation.hint")}</p>
          {/* Only meaningful in `always` mode (a companion hold never has the
              main window's focus), so it stays visible but disabled otherwise. */}
          <div className="grid grid-cols-[1fr_auto] items-center gap-3">
            <span className="text-[13px] text-foreground">
              {t("controles.ptt.companionDictation.label")}
            </span>
            <Switch
              aria-label={t("controles.ptt.companionDictation.label")}
              checked={pttState.data?.companion_dictation ?? false}
              disabled={updateWsConfig.isPending || (pttState.data?.dictation_mode ?? "send") !== "always"}
              onChange={(next) => updateWsConfig.mutate({ companion_dictation: next })}
            />
          </div>
          <p className="text-xs leading-relaxed text-muted-foreground">{t("controles.ptt.companionDictation.hint")}</p>
          <div className="grid grid-cols-[1fr_auto] items-center gap-3">
            <span className="text-[13px] text-foreground">{t("controles.ptt.grace.label")}</span>
            <Select
              aria-label={t("controles.ptt.grace.label")}
              value={graceMode}
              disabled={updateWsConfig.isPending}
              options={GRACE_MODES.map((mode) => ({ value: mode.value, label: t(mode.label) }))}
              onChange={(mode) => updateWsConfig.mutate({ grace_mode: mode as PttGraceMode })}
            />
          </div>
          {graceMode === "custom" && (
            <div className="grid grid-cols-[1fr_auto] items-center gap-3">
              <label htmlFor="ptt-grace-s" className="text-[13px] text-foreground">
                {t("controles.ptt.grace.seconds.label")}
              </label>
              <input
                id="ptt-grace-s"
                type="number"
                min={0.3}
                max={3}
                step={0.1}
                value={graceInput}
                onChange={(e) => {
                  if (updateWsConfig.isError) updateWsConfig.reset();
                  setGraceInput(e.target.value);
                }}
                onBlur={commitGrace}
                onKeyDown={(e) => {
                  if (e.key === "Enter") commitGrace();
                }}
                className={cn(inputClass, "w-24")}
              />
            </div>
          )}
          <p className="text-xs leading-relaxed text-muted-foreground">{t("controles.ptt.grace.hint")}</p>
        </section>

        <section aria-labelledby="ptt-hotkey-label" className="space-y-2">
          <span id="ptt-hotkey-label" className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.09em] text-dim">
            <Keyboard size={14} className="text-muted-foreground" aria-hidden="true" />
            {t("controles.ptt.hotkey.eyebrow")}
          </span>
          <div className="grid grid-cols-[1fr_auto] items-center gap-3">
            <Select
              aria-label={t("controles.ptt.hotkey.eyebrow")}
              value={pttState.data?.hotkey ?? "F10"}
              disabled={updateWsConfig.isPending}
              options={PTT_HOTKEY_OPTIONS.map((key) => ({
                value: key,
                label: key === "F10" ? `${key} · ${t("controles.ptt.hotkey.default")}` : key,
              }))}
              onChange={(key) => updateWsConfig.mutate({ hotkey: key })}
            />
            <kbd className="mono flex h-11 w-fit items-center rounded-md border border-border bg-surface-2 px-3 text-sm font-semibold text-foreground">
              {pttState.data?.hotkey ?? "F10"}
            </kbd>
          </div>
          <p role="status" className="text-xs text-muted-foreground">
            {t("controles.ptt.hotkey.desktopOnly.hint")}
          </p>
        </section>

        <section aria-labelledby="ptt-liveaudio-label" className="space-y-3 border-t border-border-soft pt-3.5">
          <span id="ptt-liveaudio-label" className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.09em] text-dim">
            <Radio size={14} className="text-muted-foreground" aria-hidden="true" />
            LiveAudio (STT)
          </span>

          {/* LiveAudio is a separate download, not something OpenCohost ships or
              starts. Without that note the URL field reads like an optional
              tuning knob, and the owner is left wondering why Kira can't hear
              them. */}
          <div className="flex flex-col gap-2.5">
            <p role="status" className="text-xs leading-relaxed text-muted-foreground">
              {t("controles.ptt.liveAudio.separateApp.hint")}
            </p>
            <div>
              <a
                href={LIVEAUDIO_DOWNLOAD_URL}
                target="_blank"
                rel="noreferrer"
                onClick={(e) => {
                  e.preventDefault();
                  void openExternalUrl(LIVEAUDIO_DOWNLOAD_URL);
                }}
                className="inline-flex h-9 items-center justify-center gap-1.5 rounded-md border border-border bg-card px-4 text-sm font-semibold text-foreground transition-colors duration-fast ease-io hover:border-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              >
                {t("controles.ptt.liveAudio.download")}
                <ExternalLink size={14} aria-hidden="true" />
              </a>
            </div>
          </div>

          <div className="grid grid-cols-[1fr_auto] items-center gap-3">
            <span className="text-[13px] text-foreground">{t("controles.ptt.wsUrl.active.label")}</span>
            <span className="mono text-[11px] text-dim">{activeWsUrl ?? t("controles.ptt.wsUrl.unset")}</span>
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="ptt-ws-url" className="text-[13px] text-foreground">
              {t("controles.ptt.wsUrl.input.label")}
            </label>
            <input
              id="ptt-ws-url"
              type="text"
              inputMode="url"
              value={wsUrl}
              onChange={(e) => onWsUrlChange(e.target.value)}
              placeholder={t("controles.ptt.wsUrl.input.placeholder")}
              className={inputClass}
            />
          </div>

          <div className="grid grid-cols-[1fr_auto] items-center gap-3">
            <Button type="button" disabled={updateWsConfig.isPending} onClick={saveWsUrl}>
              {t("controles.ptt.wsUrl.save.action")}
            </Button>
            <Button type="button" variant="outline" disabled={testWsConnection.isPending} onClick={runWsTest}>
              {t("controles.ptt.wsUrl.test.action")}
            </Button>
          </div>

          {schemeError && <Alert tone="warn">{t(schemeError)}</Alert>}
          {updateWsConfig.isError && (
            <Alert tone="danger">{updateWsConfig.error?.message ?? t("controles.ptt.wsUrl.save.error")}</Alert>
          )}
          {testWsConnection.isError && (
            <Alert tone="danger">{testWsConnection.error?.message ?? t("controles.ptt.wsUrl.test.error")}</Alert>
          )}
          {testWsConnection.data && (
            <Alert tone={testWsConnection.data.ok ? "ok" : "danger"}>{testWsConnection.data.detail}</Alert>
          )}
          {(error === "stt_unreachable" || testWsConnection.isError || (testWsConnection.data && !testWsConnection.data.ok)) && (
            <Alert tone="warn">
              <span>{t("controles.ptt.liveAudio.unavailable")}</span>{" "}
              <a
                href={LIVEAUDIO_DOWNLOAD_URL}
                target="_blank"
                rel="noreferrer"
                onClick={(e) => {
                  e.preventDefault();
                  void openExternalUrl(LIVEAUDIO_DOWNLOAD_URL);
                }}
                className="inline-flex items-center gap-1 font-semibold text-primary hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              >
                {t("controles.ptt.liveAudio.download")}
                <ExternalLink size={12} aria-hidden="true" />
              </a>
            </Alert>
          )}
        </section>
      </div>
    </Card>
  );
}
