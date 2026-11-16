import { useEffect, useRef, useState } from "react";
import { Check, Loader2, Volume2 } from "lucide-react";
import { getTtsConfig, type TtsConfigResponse } from "../../api/client.js";
import { useEngineCommand } from "../../api/engineCommand.js";
import { SpeechUnavailableError, postSpeechSay } from "../../api/speech.js";
import { useTtsConfigQuery } from "../../api/tts.js";
import { Alert } from "../../ui/Alert.js";
import { Button } from "../../ui/Button.js";
import { useT, type TKey } from "../../i18n/t.js";
import { SPEED_SCALE, closestSpeedOption, type SpeedOption } from "../controles/VoiceCard.js";
import type { StepProps } from "./SetupSteps.js";

type PlayState = "idle" | "playing" | "played" | "skipped" | "unavailable" | "error";
type ApplyOutcome = "ok" | "timeout" | "request";
type PendingVoiceOp =
  | { id: number; part: "kind"; value: boolean }
  | { id: number; part: "speed"; value: SpeedOption };

const OPTION_BTN_CLASS =
  "aria-[pressed=true]:border-primary aria-[pressed=true]:bg-accent-soft aria-[pressed=true]:text-primary";

const SPEEDS: ReadonlyArray<{ value: SpeedOption; label: TKey }> = [
  { value: "fast", label: "setup.voice.speed.fast" },
  { value: "medium", label: "setup.voice.speed.medium" },
  { value: "calm", label: "setup.voice.speed.calm" },
  { value: "slow", label: "setup.voice.speed.slow" }
];

/** Poll budget for a queued voice change to show up in the config (mutable for tests). */
export const TTS_CONFIG_POLL = { intervalMs: 200, attempts: 15 };

/**
 * Commands are queued by the engine; wait (bounded) until the config shows
 * the change. True once it does, false when the budget runs out. Never throws.
 */
async function waitForTtsConfig(matches: (config: TtsConfigResponse) => boolean): Promise<boolean> {
  for (let attempt = 0; attempt < TTS_CONFIG_POLL.attempts; attempt += 1) {
    if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, TTS_CONFIG_POLL.intervalMs));
    try {
      if (matches(await getTtsConfig())) return true;
    } catch {
      // keep trying until the budget runs out
    }
  }
  return false;
}

/** The voice screens: each asks exactly one thing. */
export type VoicePart = "kind" | "speed" | "test";

export interface VoiceStepProps extends StepProps {
  part: VoicePart;
}

/**
 * Voice block, one decision per screen: kind (Piper on the PC vs Edge online),
 * speed, then the "did you hear it?" test. The flow keeps this component
 * mounted across the three screens, so the queue of applied changes survives
 * the move. The choices use the same engine commands as the Controles voice
 * card; the test line plays only after they were applied, and not at all when
 * a change never showed up (it would play stale settings). "No se oye" only
 * silences the setup narration; the app's voice setting is not touched.
 */
export function VoiceStep({ part, state, dispatch }: VoiceStepProps) {
  const t = useT();
  const { data: config } = useTtsConfigQuery();
  const localOnlyCommand = useEngineCommand<boolean>();
  const speedCommand = useEngineCommand<number>();
  const [localChoice, setLocalChoice] = useState<boolean | null>(null);
  const [speedChoice, setSpeedChoice] = useState<SpeedOption | null>(null);
  const [pendingOps, setPendingOps] = useState<PendingVoiceOp[]>([]);
  const [applyError, setApplyError] = useState<"timeout" | "request" | null>(null);
  const [play, setPlay] = useState<PlayState>("idle");
  // Applies run one after another; playing waits for the queue to drain.
  const settled = useRef<Promise<void>>(Promise.resolve());
  // False while the latest queued change failed or never showed up in the config.
  const applied = useRef(true);
  const nextOpId = useRef(1);
  const questionRef = useRef<HTMLDivElement>(null);

  // Nothing is shown as chosen, and nothing can be changed, until the real settings load.
  const loaded = Boolean(config);
  const piperMissing = config?.piper_available === false;
  const localOnly = localChoice ?? config?.local_only ?? null;
  const speed = speedChoice ?? (config ? closestSpeedOption(config.speed) : null);

  function enqueue(
    op: Omit<PendingVoiceOp, "id">,
    task: () => Promise<ApplyOutcome>,
    revert: () => void
  ) {
    const id = nextOpId.current++;
    const entry = { ...op, id } as PendingVoiceOp;
    setApplyError(null);
    setPendingOps((current) => [...current, entry]);
    settled.current = settled.current.then(async () => {
      try {
        const outcome = await task();
        const ok = outcome === "ok";
        applied.current = ok;
        if (!ok) {
          revert();
          setApplyError(outcome);
        }
      } finally {
        setPendingOps((current) => current.filter((item) => item.id !== id));
      }
    });
  }

  function chooseLocalOnly(value: boolean) {
    setLocalChoice(value);
    enqueue(
      { part: "kind", value },
      async () => {
        if ((await localOnlyCommand.run("set_tts_local_only", value)) === undefined) return "request";
        return (await waitForTtsConfig((current) => current.local_only === value)) ? "ok" : "timeout";
      },
      () => setLocalChoice(null)
    );
  }

  function chooseSpeed(value: SpeedOption) {
    setSpeedChoice(value);
    enqueue(
      { part: "speed", value },
      async () => {
        if ((await speedCommand.run("set_tts_speed", SPEED_SCALE[value])) === undefined) return "request";
        return (await waitForTtsConfig((current) => Math.abs(current.speed - SPEED_SCALE[value]) < 0.001)) ? "ok" : "timeout";
      },
      () => setSpeedChoice(null)
    );
  }

  function handlePlay() {
    setPlay("playing");
    settled.current
      .then(async (): Promise<PlayState> => {
        // The apply error is already on screen; still ask, so the user is never stuck here.
        if (!applied.current) return "skipped";
        await postSpeechSay(t("setup.voice.testLine"), "now");
        return "played";
      })
      .then(setPlay)
      .catch((error: unknown) => setPlay(error instanceof SpeechUnavailableError ? "unavailable" : "error"));
  }

  // The flow only shows the voice-choice screen while the local voice is on.
  useEffect(() => {
    if (localOnly !== null) dispatch({ type: "voiceKind", local: localOnly });
  }, [localOnly, dispatch]);

  const asked = play !== "idle" && play !== "playing";

  // In a short window the question lands below the fold: bring it into view.
  useEffect(() => {
    if (asked) questionRef.current?.scrollIntoView?.({ block: "nearest", behavior: "smooth" });
  }, [asked]);

  const applyAlert = applyError && (
    <Alert tone="warn" role="status">
      <span>{t("setup.voice.applyError")}</span>{" "}
      <span className="text-xs opacity-90">
        {t(applyError === "timeout" ? "setup.voice.applyTimeoutDetail" : "setup.voice.applyCommandFailedDetail")}
      </span>
    </Alert>
  );

  const isOptionPending = (targetPart: PendingVoiceOp["part"], optionValue: boolean | string) =>
    pendingOps.some((op) => op.part === targetPart && op.value === optionValue);
  const isPartPending = (targetPart: PendingVoiceOp["part"]) =>
    pendingOps.some((op) => op.part === targetPart);

  function applyingNotice(targetPart: PendingVoiceOp["part"]) {
    if (!isPartPending(targetPart)) return null;
    return (
      <p role="status" className="inline-flex items-center gap-2 text-xs text-info">
        <Loader2 size={13} className="shrink-0 animate-spin motion-reduce:animate-none" aria-hidden="true" />
        <span>{t("setup.voice.applying")}</span>
      </p>
    );
  }

  function optionIcon(pressed: boolean, pending: boolean) {
    if (pending) return <Loader2 size={14} className="shrink-0 animate-spin motion-reduce:animate-none" aria-hidden="true" />;
    if (pressed) return <Check size={14} className="shrink-0 text-primary" aria-hidden="true" />;
    return null;
  }

  if (part === "kind") {
    const piperPressed = !piperMissing && localOnly === true;
    const edgePressed = localOnly === false;
    return (
      <div className="flex flex-col gap-5">
        <p className="max-w-xl text-sm leading-relaxed text-muted-foreground">{t("setup.voice.copy")}</p>
        <div role="group" aria-label={t("setup.voice.kind.aria")} className="flex flex-col gap-2">
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              aria-pressed={piperPressed}
              aria-busy={isOptionPending("kind", true) || undefined}
              disabled={!loaded || piperMissing}
              onClick={() => chooseLocalOnly(true)}
              className={OPTION_BTN_CLASS}
            >
              {optionIcon(piperPressed, isOptionPending("kind", true))}
              {t("setup.voice.kind.piper")}
            </Button>
            <Button
              type="button"
              variant="outline"
              aria-pressed={edgePressed}
              aria-busy={isOptionPending("kind", false) || undefined}
              disabled={!loaded}
              onClick={() => chooseLocalOnly(false)}
              className={OPTION_BTN_CLASS}
            >
              {optionIcon(edgePressed, isOptionPending("kind", false))}
              {t("setup.voice.kind.edge")}
            </Button>
          </div>
          {applyingNotice("kind")}
          {piperMissing && <p className="text-xs text-muted-foreground">{t("setup.voice.kind.piperMissing")}</p>}
        </div>
        {applyAlert}
      </div>
    );
  }

  if (part === "speed") {
    return (
      <div className="flex flex-col gap-5">
        <div role="group" aria-label={t("setup.voice.speed.aria")} className="flex flex-col gap-2">
          <p className="text-sm font-semibold text-foreground">{t("setup.voice.speed.question")}</p>
          <div className="flex flex-wrap gap-2">
            {SPEEDS.map((option) => {
              const pressed = speed === option.value;
              const pending = isOptionPending("speed", option.value);
              return (
                <Button
                  key={option.value}
                  type="button"
                  variant="outline"
                  aria-pressed={pressed}
                  aria-busy={pending || undefined}
                  disabled={!loaded}
                  onClick={() => chooseSpeed(option.value)}
                  className={OPTION_BTN_CLASS}
                >
                  {optionIcon(pressed, pending)}
                  {t(option.label)}
                </Button>
              );
            })}
          </div>
          {applyingNotice("speed")}
        </div>
        {applyAlert}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      {applyAlert}

      <Button type="button" variant="primary" disabled={play === "playing"} onClick={handlePlay} className="h-11 self-start px-5">
        {play === "playing" ? (
          <Loader2 size={15} className="animate-spin motion-reduce:animate-none" aria-hidden="true" />
        ) : (
          <Volume2 size={15} aria-hidden="true" />
        )}
        {play === "playing" ? t("setup.voice.playing") : t("setup.voice.play")}
      </Button>

      <div aria-live="polite" className="flex flex-col gap-3">
        {play === "unavailable" && <Alert tone="warn" role="status">{t("setup.voice.unavailable")}</Alert>}
        {play === "error" && <Alert tone="warn" role="status">{t("setup.voice.error")}</Alert>}
        {asked && (
          <div ref={questionRef} className="flex flex-col gap-2.5">
            <p className="text-sm font-semibold text-foreground">{t("setup.voice.question")}</p>
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" aria-pressed={state.voice === "ok"} onClick={() => dispatch({ type: "voiceResult", heard: true })}>
                {t("setup.voice.yes")}
              </Button>
              <Button type="button" variant="outline" aria-pressed={state.voice === "off"} onClick={() => dispatch({ type: "voiceResult", heard: false })}>
                {t("setup.voice.no")}
              </Button>
            </div>
            <p className="text-xs leading-relaxed text-muted-foreground">{t("setup.voice.noHint")}</p>
          </div>
        )}
        {state.voice === "ok" && <p className="text-sm font-medium text-ok">{t("setup.voice.ok")}</p>}
        {state.voice === "off" && <p className="text-sm font-medium text-warn">{t("setup.voice.off")}</p>}
      </div>
    </div>
  );
}
