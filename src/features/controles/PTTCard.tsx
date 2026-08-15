import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from "react";
import { Card } from "../../ui/Card.js";
import { Button } from "../../ui/Button.js";
import { Alert } from "../../ui/Alert.js";
import { cn } from "../../lib/cn.js";
import { usePttHold, useTestPttConnectionMutation, useUpdatePttConfigMutation, usePttStateQuery } from "../../api/ptt.js";
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

        <section aria-labelledby="ptt-hotkey-label" className="space-y-2">
          <span id="ptt-hotkey-label" className="text-[11px] font-semibold uppercase tracking-[0.09em] text-dim">
            {t("controles.ptt.hotkey.eyebrow")}
          </span>
          <div className="grid grid-cols-[1fr_auto] items-center gap-3">
            <kbd className="mono w-fit rounded-[6px] border border-border bg-card px-2 py-[3px] text-xs text-foreground">
              F10
            </kbd>
            <Button type="button" variant="outline" disabled title={t("controles.ptt.hotkey.mapButton.hint")}>
              {t("controles.ptt.hotkey.mapButton.action")}
            </Button>
          </div>
          <p role="status" className="text-xs text-muted-foreground">
            {t("controles.ptt.hotkey.desktopOnly.hint")}
          </p>
        </section>

        <section aria-labelledby="ptt-liveaudio-label" className="space-y-3 border-t border-border-soft pt-3.5">
          <span id="ptt-liveaudio-label" className="text-[11px] font-semibold uppercase tracking-[0.09em] text-dim">
            LiveAudio (WhisperLive)
          </span>

          {/* LiveAudio is a separate download, not something OpenCohost ships or
              starts. Without that note the URL field reads like an optional
              tuning knob, and the owner is left wondering why Kira can't hear
              them. */}
          <p role="status" className="text-xs leading-relaxed text-muted-foreground">
            {t("controles.ptt.liveAudio.separateApp.hint")}
          </p>

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
        </section>
      </div>
    </Card>
  );
}
