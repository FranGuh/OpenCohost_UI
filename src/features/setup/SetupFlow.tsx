import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent, ReactNode } from "react";
import { ArrowLeft, ArrowRight, Loader2, X } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { getLlmReadiness, type LlmReadinessResponse } from "../../api/client.js";
import { useModelsQuery } from "../../api/models.js";
import { useLlmProvider, useUpdateLlmProvider } from "../../api/llmProvider.js";
import { useStartModelDownload } from "../../api/modelDownloads.js";
import { useEngineCommand } from "../../api/engineCommand.js";
import { useTtsConfigQuery } from "../../api/tts.js";
import { useVrmModelsQuery } from "../../api/avatar.js";
import { deleteSetupCheckpoint, putSetupCheckpoint, waitForActiveModel, type SetupCheckpoint } from "../../api/setup.js";
import { useUiLocale } from "../../i18n/locale.js";
import { useAvatarPresentationStore } from "../../store/avatarPresentationStore.js";
import { useEventStore } from "../../store/eventStore.js";
import { LLM_READINESS_QUERY_KEY } from "../shared/useLlmReadiness.js";
import { Button } from "../../ui/Button.js";
import { Alert } from "../../ui/Alert.js";
import { useT, type TKey } from "../../i18n/t.js";
import { cn } from "../../lib/cn.js";
import { requestErrorMessage } from "../models/downloads/downloadCopy.js";
import { SupportLinks } from "../shell/SupportLinks.js";
import {
  CPU_RECOMMENDED_MODEL,
  canAdvance,
  initialSetupState,
  narrationFor,
  progressSteps,
  reduceSetup,
  resumedSetupState,
  stepIndex,
  stepProgress,
  type CatalogEntryLike,
  type HardwareFacts,
  type SetupStep
} from "./setupMachine.js";
import { KiraNarrator, useNarrationVoice } from "./KiraNarrator.js";
import { DoneStep, ENGINE_TITLE, EngineStep, HardwareStep, KiraLanguageStep, LanguageStep, NarratorStep, WelcomeStep, localOllamaAvailability } from "./SetupSteps.js";
import { VoiceStep } from "./VoiceStep.js";
import { hasNarratorPref, readNarratorMuted, writeNarratorMuted } from "./narratorPref.js";
import { AvatarStep, LiveAudioStep, PersonalizeIntroStep, ProfileStep, SearchStep, ThemeStep } from "./PersonalizeSteps.js";
import { ModelStep } from "./ModelStep.js";
import { CloudKeyStep, FallbackStep } from "./CloudKeyStep.js";
import { InferenceTestStep } from "./InferenceTestStep.js";
import {
  checkpointNeedsVrm,
  checkpointResumeStep,
  restoreCheckpoint,
  savedCheckpointLanguage,
  toCheckpoint,
  type LiveFacts,
  type SetupSection
} from "./setupCheckpoint.js";

export interface SetupFlowProps {
  /** "modal": first-run overlay with focus trap and Escape; "panel": inline (e.g. the /setup command). */
  variant: "modal" | "panel";
  onClose(): void;
  onComplete(): void;
  /** The setup was already completed: open on the summary, prefilled from the current configuration. */
  resume?: boolean;
  /** S10: saved progress of an unfinished setup; the first screen offers to continue from it. Ignored with `resume`. */
  checkpoint?: SetupCheckpoint | null;
  /** S10: the saved progress was unreadable and was discarded; say so once on the first screen. */
  checkpointReset?: boolean;
  /** S10: `/setup <section>`. On a completed setup it opens that block and returns to the summary. */
  section?: SetupSection | null;
}

/** A one-line note shown only on the screen it belongs to. */
interface StepNotice {
  key: TKey;
  step: SetupStep;
}

function initialNotice(resume: boolean, section: SetupSection | null, checkpointReset: boolean): StepNotice | null {
  if (resume) return section?.kind === "unknown" ? { key: "setup.section.unknown", step: "done" } : null;
  if (section) return { key: section.kind === "unknown" ? "setup.section.unknown" : "setup.section.notYet", step: "language" };
  return checkpointReset ? { key: "setup.resume.reset", step: "language" } : null;
}

/** Counter chips are per block: a screen that belongs to a block reuses its head's label. */
const STEP_LABEL: Record<SetupStep, TKey> = {
  language: "setup.step.language",
  kiraLanguage: "setup.step.language",
  narrator: "setup.step.language",
  welcome: "setup.step.welcome",
  hardware: "setup.step.hardware",
  engine: "setup.step.engine",
  model: "setup.step.model",
  apiKey: "setup.step.apiKey",
  fallback: "setup.step.apiKey",
  voice: "setup.step.voice",
  voiceSpeed: "setup.step.voice",
  voiceTest: "setup.step.voice",
  test: "setup.step.test",
  personalize: "setup.step.personalize",
  avatar: "setup.step.personalize",
  profile: "setup.step.personalize",
  search: "setup.step.personalize",
  liveaudio: "setup.step.personalize",
  theme: "setup.step.personalize",
  done: "setup.step.done"
};

const STEP_TITLE: Record<SetupStep, TKey> = {
  language: "setup.language.title",
  kiraLanguage: "setup.kiraLanguage.title",
  narrator: "setup.narrator.title",
  welcome: "setup.welcome.title",
  hardware: "setup.hardware.title",
  engine: "setup.engine.title",
  model: "setup.model.title",
  apiKey: "setup.apiKey.title",
  fallback: "setup.fallback.title",
  voice: "setup.voice.title",
  voiceSpeed: "setup.voiceSpeed.title",
  voiceTest: "setup.voiceTest.title",
  test: "setup.test.title",
  personalize: "setup.personalize.title",
  avatar: "setup.avatar.title",
  profile: "setup.profile.title",
  search: "setup.search.title",
  liveaudio: "setup.liveaudio.title",
  theme: "setup.theme.title",
  done: "setup.done.title"
};

/** Steps whose own primary action saves what was typed; the footer offers no Continue there. */
const STEP_OWNS_PRIMARY: ReadonlySet<SetupStep> = new Set(["profile", "search"]);

const VOICE_PART = { voice: "kind", voiceSpeed: "speed", voiceTest: "test" } as const;

/** From this counter step on, closing asks first (the language and welcome blocks close at once). */
const CONFIRM_CLOSE_FROM_STEP = 3;

const FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]),textarea:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])';

/** Hardware facts from GET /api/llm/readiness; null until the first read lands. */
export function hardwareFacts(readiness: LlmReadinessResponse | undefined): HardwareFacts | null {
  if (!readiness) return null;
  const vramMb = readiness.hardware?.total_vram_mb ?? 0;
  const hasGpu = readiness.hardware?.cpu_only === undefined ? vramMb > 0 : !readiness.hardware.cpu_only && vramMb > 0;
  return { hasGpu, gpuName: readiness.hardware?.gpu_name ?? null, vramGb: Math.round((vramMb / 1024) * 10) / 10 };
}

/**
 * Setup assistant (setup-assistant-20261008 T3). Presentational shell around
 * the pure step machine: it does not know where it is mounted. The welcome
 * slot renders it as a modal; the /setup command renders it as a panel.
 */
export function SetupFlow({
  variant,
  onClose,
  onComplete,
  resume = false,
  checkpoint = null,
  checkpointReset = false,
  section = null
}: SetupFlowProps) {
  const t = useT();
  const { locale, setLocale } = useUiLocale();
  const [state, dispatch] = useReducer(reduceSetup, resume, (resumed: boolean) =>
    resumed ? resumedSetupState({ engine: null, hasGpu: false, model: null, cloud: null }) : initialSetupState()
  );
  const [muted, setMutedState] = useState(readNarratorMuted);
  // The "do you want to hear Kira?" answer: preselected from a stored choice, null until answered.
  const [hearKira, setHearKira] = useState<boolean | null>(() => (hasNarratorPref() ? !readNarratorMuted() : null));
  const setMuted = useCallback((next: boolean) => {
    setMutedState(next);
    writeNarratorMuted(next);
    // Toggling the voice is an answer to the first-screen question too.
    setHearKira(!next);
  }, []);
  const [confirmClose, setConfirmClose] = useState(false);
  const [cloudFallback, setCloudFallback] = useState(false);
  const [advancing, setAdvancing] = useState(false);
  const [advanceError, setAdvanceError] = useState<TKey | null>(null);
  const [fallbackDownloadNotice, setFallbackDownloadNotice] = useState<string | null>(null);
  // S10: saved progress waiting for "Continuar" / "Empezar de nuevo"; null once answered (or none).
  const [offer, setOffer] = useState<SetupCheckpoint | null>(() => (!resume && checkpoint ? checkpoint : null));
  const [notice, setNotice] = useState<StepNotice | null>(() => initialNotice(resume, section, checkpointReset));

  // The saved language applies at once in the first-run modal so the resume question is already in it.
  // In the inline `/setup` panel, keep the active UI locale instead of clobbering it with an older checkpoint.
  useEffect(() => {
    if (variant !== "modal") return;
    const language = offer ? savedCheckpointLanguage(offer) : null;
    if (language && language !== locale) setLocale(language);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, on open
  }, []);

  // One read, shared cache with useLlmReadiness; this observer never polls.
  const readinessQuery = useQuery({ queryKey: LLM_READINESS_QUERY_KEY, queryFn: getLlmReadiness });
  const readiness = readinessQuery.data;
  const ollamaAvailability = localOllamaAvailability(readiness);
  // Preserve the user's choice when readiness changes; never silently select cloud.
  const localEngineBlocked =
    state.step === "engine" && state.engine !== null && state.engine !== "cloud" &&
    (ollamaAvailability === "missing" || ollamaAvailability === "offline");
  // Kira stays quiet on the language block until the user has said they want to hear her.
  const awaitingHearAnswer =
    (state.step === "language" || state.step === "kiraLanguage" || state.step === "narrator") && hearKira === null;
  const canContinue = canAdvance(state) && !localEngineBlocked && !(state.step === "narrator" && hearKira === null);
  const hardware = useMemo(() => hardwareFacts(readiness), [readiness]);
  const modelsQuery = useModelsQuery();
  const models = modelsQuery.data;
  const providerQuery = useLlmProvider();
  const provider = providerQuery.data;
  const ttsQuery = useTtsConfigQuery();
  const ttsConfig = ttsQuery.data;
  const avatarMode = useAvatarPresentationStore((s) => s.mode);
  const selectedVrm = useAvatarPresentationStore((s) => s.selectedModel);
  const offerNeedsVrm = offer !== null && checkpointNeedsVrm(offer);
  const vrmQuery = useVrmModelsQuery({ enabled: offerNeedsVrm });
  const updateProvider = useUpdateLlmProvider();
  const startDownload = useStartModelDownload();
  const modelCommand = useEngineCommand<string>((status, value) => status.current_model === value);

  useEffect(() => {
    if (hardware) dispatch({ type: "hardware", hasGpu: hardware.hasGpu });
  }, [hardware]);

  useEffect(() => {
    dispatch({ type: "ollama", missing: ollamaAvailability === "missing" });
  }, [ollamaAvailability]);

  // Re-opened, completed setup: fill the summary from the current configuration once it is known.
  const prefilled = useRef(false);
  useEffect(() => {
    if (!resume || prefilled.current || !provider || !models || !hardware) return;
    prefilled.current = true;
    const active = provider.active_provider;
    const profile = active !== "local" ? provider.profiles[active] : undefined;
    dispatch({
      type: "prefill",
      hasGpu: hardware.hasGpu,
      engine: active === "local" ? (hardware.hasGpu ? "gpu" : "cpu") : profile ? "cloud" : null,
      model: active === "local" ? models.current_model ?? null : null,
      cloud: profile ? { preset: profile.preset, model: profile.model } : null
    });
    // `/setup <section>`: open that block on the prefilled summary; Continue comes back to it.
    if (section?.kind === "step") dispatch({ type: "jump", step: section.step });
  }, [resume, provider, models, hardware, section]);

  const catalog = (models?.catalog ?? {}) as Record<string, CatalogEntryLike>;
  const gpuRecommended = readiness?.hardware?.recommended_tag ?? readiness?.hardware?.recommended_model ?? null;
  const recommendedTag = state.engine === "cpu" ? CPU_RECOMMENDED_MODEL : gpuRecommended;
  const recommendedName = recommendedTag ? catalog[recommendedTag]?.display ?? recommendedTag : null;
  const installed = useMemo(
    () => Array.from(new Set([...(models?.discovered ?? []), ...(readiness?.ollama?.installed_models ?? [])])),
    [models?.discovered, readiness?.ollama?.installed_models]
  );

  // ─── S10 checkpoints ───────────────────────────────────────────────────────
  const voiceKind = ttsConfig ? (ttsConfig.local_only ? "piper" : "edge") : null;
  const checkpointBody = JSON.stringify(
    toCheckpoint(state, {
      language: locale === "en" ? "en" : "es",
      hearKira,
      voiceKind,
      avatar: state.personalize ? avatarMode : null
    })
  );
  // Writes run one after another (never out of order) and never block or report: best effort.
  const saveChain = useRef<Promise<void>>(Promise.resolve());
  const lastSaved = useRef<string | null>(null);
  useEffect(() => {
    // Nothing worth resuming on the first screen; a completed setup has nothing to resume.
    if (resume || offer || state.step === "language" || lastSaved.current === checkpointBody) return;
    lastSaved.current = checkpointBody;
    saveChain.current = saveChain.current
      .then(() => putSetupCheckpoint(JSON.parse(checkpointBody)))
      .catch(() => undefined);
  }, [checkpointBody, resume, offer, state.step]);

  const saveCheckpointForStep = useCallback(async (stepOverride: SetupStep) => {
    if (resume || offer) return;
    const body = toCheckpoint(
      { ...state, step: stepOverride },
      {
        language: locale === "en" ? "en" : "es",
        hearKira,
        voiceKind,
        avatar: state.personalize ? avatarMode : null
      }
    );
    lastSaved.current = JSON.stringify(body);
    const write = saveChain.current
      .then(() => putSetupCheckpoint(body))
      .catch(() => undefined);
    saveChain.current = write;
    await write;
  }, [resume, offer, state, locale, hearKira, voiceKind, avatarMode]);

  // A query that failed or is disabled counts as settled: its fact is then "unknown" and the answer is kept.
  const settled = (query: { isPending: boolean; fetchStatus: string }) => !query.isPending || query.fetchStatus === "idle";
  const liveReady =
    settled(readinessQuery) && settled(modelsQuery) && settled(providerQuery) && settled(ttsQuery) &&
    (!offerNeedsVrm || settled(vrmQuery));

  function liveFacts(): LiveFacts {
    const active = provider?.active_provider;
    const profile = active && active !== "local" ? provider?.profiles[active] : undefined;
    return {
      hasGpu: hardware ? hardware.hasGpu : null,
      ollama: ollamaAvailability,
      installed: models || readiness ? installed : null,
      activeCloud: provider ? (profile ? { preset: profile.preset, keySet: profile.api_key_set } : null) : undefined,
      piperAvailable: ttsConfig?.piper_available ?? null,
      ttsLocalOnly: ttsConfig?.local_only ?? null,
      vrm: vrmQuery.data ? { files: vrmQuery.data.map((item) => item.filename), selected: selectedVrm || null } : null
    };
  }

  function continueFromCheckpoint() {
    if (!offer || !liveReady) return;
    const restored = restoreCheckpoint(offer, liveFacts());
    if (variant === "modal" && restored.language && restored.language !== locale) setLocale(restored.language);
    if (restored.hearKira !== null) setMuted(!restored.hearKira);
    dispatch({ type: "restore", state: restored.state });
    setNotice(restored.reason ? { key: restored.reason, step: restored.state.step } : null);
    setOffer(null);
  }

  function startOver() {
    setOffer(null);
    setNotice(null);
    void deleteSetupCheckpoint().catch(() => undefined);
  }

  const chosenModelName =
    state.engine === "cloud" ? state.cloud?.model ?? null : state.model ? catalog[state.model]?.display ?? state.model : null;
  const narration = narrationFor(state, hardware, {
    recommendedName,
    engineName: state.engine ? t(ENGINE_TITLE[state.engine]) : null,
    modelName: chosenModelName
  });
  const line = offer ? t("setup.kira.resume") : t(narration.key, narration.vars);
  const voiceEnabled = !muted && state.voice !== "off" && !awaitingHearAnswer;
  useNarrationVoice(line, voiceEnabled);

  const index = stepIndex(state);
  const progress = stepProgress(state);
  // A block of screens shows as one chip, like it counts as one step.
  const chips = progressSteps(state.engine);
  const chipIndex = progress.current - 1;
  const isDone = state.step === "done";

  /** Esc / X: finishing on the summary, asking first once the user is past the first two screens. */
  function requestClose() {
    if (isDone) onComplete();
    else if (progress.current >= CONFIRM_CLOSE_FROM_STEP) setConfirmClose(true);
    else onClose();
  }

  const rootRef = useRef<HTMLElement>(null);
  // Latest onClose without re-running the mount effect (which owns focus restore).
  const escapeRef = useRef(() => {});
  escapeRef.current = () => (confirmClose ? setConfirmClose(false) : requestClose());
  useEffect(() => {
    if (variant !== "modal") return;
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !event.defaultPrevented) escapeRef.current();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      previouslyFocused?.focus();
    };
  }, [variant]);

  // Focus the new step's heading on every step change (and on open in the modal).
  // Declared after the mount effect above so it captures the opener first.
  const headingRef = useRef<HTMLHeadingElement>(null);
  const firstRender = useRef(true);
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      if (variant !== "modal") return;
    }
    headingRef.current?.focus();
  }, [state.step, variant]);

  function trapTab(event: ReactKeyboardEvent<HTMLElement>) {
    if (variant !== "modal" || event.key !== "Tab") return;
    const focusables = Array.from(rootRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []);
    if (focusables.length === 0) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  /** Side effects that must succeed before leaving a step. */
  const commitStep = useCallback(async (): Promise<boolean> => {
    if (state.step === "model" && state.model) {
      if (provider && provider.active_provider !== "local") {
        await updateProvider.mutateAsync({ active_provider: "local" });
      }
      // Accepted is not applied: the engine may still be loading the model,
      // defer the switch while busy, or reject it after the accept. Leaving
      // here early let the speed test measure whatever model was still active.
      const since = Date.now();
      const accepted = await modelCommand.run("switch_model", state.model);
      if (accepted === undefined) return false;
      return waitForActiveModel(state.model, {
        failed: () =>
          useEventStore
            .getState()
            .events.some((event) => event.ts >= since && event.source === "motor" && event.action === "model_switch_failed")
      });
    }
    if (state.step === "fallback") {
      setFallbackDownloadNotice(null);
      if (cloudFallback && !installed.includes(CPU_RECOMMENDED_MODEL)) {
        if (ollamaAvailability === "missing" || ollamaAvailability === "offline") {
          const key = ollamaAvailability === "missing"
            ? "setup.apiKey.fallbackUnavailable.missing"
            : "setup.apiKey.fallbackUnavailable.offline";
          setFallbackDownloadNotice(t(key));
        } else {
          // Optional local fallback must never block the validated cloud path.
          // Keep the exact request error mapping visible after this step unmounts.
          startDownload.mutate(CPU_RECOMMENDED_MODEL, {
            onError: (error) => setFallbackDownloadNotice(requestErrorMessage(error, t))
          });
        }
      }
    }
    return true;
  }, [state.step, state.model, provider, updateProvider, modelCommand, cloudFallback, installed, startDownload, ollamaAvailability, t]);

  async function handleNext() {
    if (!canContinue || advancing) return;
    setAdvanceError(null);
    setAdvancing(true);
    // Only the model step activates something; any other step that fails gets the generic line.
    const failure: TKey = state.step === "model" ? "setup.model.activateError" : "setup.nav.nextError";
    try {
      const ok = await commitStep();
      if (ok) dispatch({ type: "next" });
      else setAdvanceError(failure);
    } catch {
      setAdvanceError(failure);
    } finally {
      setAdvancing(false);
    }
  }

  function handleBack() {
    setAdvanceError(null);
    dispatch({ type: "back" });
  }

  let body: ReactNode;
  if (offer) {
    body = (
      <div className="flex max-w-xl flex-col gap-4">
        <p className="text-sm leading-relaxed text-muted-foreground">{t("setup.resume.copy")}</p>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="primary" disabled={!liveReady} onClick={continueFromCheckpoint}>
            {t("setup.resume.continue", { step: t(STEP_LABEL[checkpointResumeStep(offer)]) })}
          </Button>
          <Button type="button" variant="outline" onClick={startOver}>
            {t("setup.resume.restart")}
          </Button>
        </div>
        {!liveReady && (
          <p role="status" className="text-xs text-dim">
            {t("setup.resume.checking")}
          </p>
        )}
      </div>
    );
  } else switch (state.step) {
    case "language":
      body = <LanguageStep />;
      break;
    case "kiraLanguage":
      body = <KiraLanguageStep onBeforeRestart={() => saveCheckpointForStep("narrator")} />;
      break;
    case "narrator":
      body = (
        <NarratorStep
          hearKira={hearKira}
          onHearKira={(hear) => {
            setHearKira(hear);
            setMuted(!hear);
          }}
        />
      );
      break;
    case "welcome":
      body = <WelcomeStep />;
      break;
    case "hardware":
      body = (
        <HardwareStep
          readiness={readiness}
          hardware={hardware}
          isError={readinessQuery.isError}
          isFetching={readinessQuery.isFetching}
          onRecheck={() => void readinessQuery.refetch()}
          catalog={catalog}
        />
      );
      break;
    case "engine":
      body = (
        <EngineStep
          labelledBy="setup-step-title"
          state={state}
          dispatch={dispatch}
          gpuRecommendedName={gpuRecommended ? catalog[gpuRecommended]?.display ?? gpuRecommended : null}
          ollamaAvailability={ollamaAvailability}
          onRecheck={() => void readinessQuery.refetch()}
          isFetching={readinessQuery.isFetching}
        />
      );
      break;
    case "model":
      body = (
        <ModelStep
          state={state}
          dispatch={dispatch}
          catalog={catalog}
          catalogLoaded={Boolean(models)}
          hardware={hardware}
          recommended={recommendedTag}
          installed={installed}
          ollamaAvailability={ollamaAvailability}
          activating={advancing && state.step === "model"}
        />
      );
      break;
    case "apiKey":
      body = (
        <CloudKeyStep state={state} dispatch={dispatch} />
      );
      break;
    case "fallback":
      body = <FallbackStep fallback={cloudFallback} onFallbackChange={setCloudFallback} ollamaAvailability={ollamaAvailability} />;
      break;
    case "voice":
    case "voiceSpeed":
    case "voiceTest":
      // One element for the three screens, so the queued voice changes survive the move.
      body = <VoiceStep part={VOICE_PART[state.step]} state={state} dispatch={dispatch} />;
      break;
    case "test":
      body = (
        <InferenceTestStep
          state={state}
          dispatch={dispatch}
          expectedModel={state.engine !== "cloud" && state.model ? { tag: state.model, name: chosenModelName ?? state.model } : null}
        />
      );
      break;
    case "personalize":
      body = <PersonalizeIntroStep dispatch={dispatch} />;
      break;
    case "avatar":
      body = <AvatarStep state={state} dispatch={dispatch} />;
      break;
    case "profile":
      body = <ProfileStep state={state} dispatch={dispatch} />;
      break;
    case "search":
      body = <SearchStep state={state} dispatch={dispatch} />;
      break;
    case "liveaudio":
      body = <LiveAudioStep />;
      break;
    case "theme":
      body = <ThemeStep />;
      break;
    case "done":
      body = (
        <DoneStep
          state={state}
          modelName={chosenModelName}
          voiceSummary={ttsConfig ? (ttsConfig.local_only ? "Piper" : "Edge") : null}
          onEdit={(step) => dispatch({ type: "edit", step })}
        />
      );
      break;
  }

  const isModal = variant === "modal";
  const nextLabel =
    state.step === "welcome"
      ? t("setup.nav.start")
      : state.step === "model" && advancing
        ? t("setup.model.activating")
        : t("setup.nav.next");

  const content = (
    <section
      ref={rootRef}
      role={isModal ? "dialog" : undefined}
      aria-modal={isModal ? true : undefined}
      aria-label={t("setup.dialog.aria")}
      onKeyDown={trapTab}
      className={cn(
        "relative flex w-full flex-col overflow-hidden bg-card text-card-foreground",
        isModal
          ? "h-[min(720px,calc(100dvh-2rem))] max-w-5xl rounded-2xl border border-border shadow-2xl md:grid md:grid-cols-[minmax(240px,300px)_1fr]"
          : "rounded-md border border-border-soft shadow-panel"
      )}
    >
      <KiraNarrator
        line={line}
        muted={muted}
        textMode={state.voice === "off"}
        onToggleMute={() => setMuted(!muted)}
        compact={!isModal}
      />

      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <header className="flex items-start justify-between gap-3 border-b border-border-soft px-5 pb-3 pt-4">
          <div className="min-w-0">
            <div className="font-mono text-[11px] font-semibold uppercase tracking-[.18em] text-primary">
              {t("setup.header.brand")}
              <span className="mx-2 text-border" aria-hidden="true">/</span>
              <span>{t("setup.header.counter", progress)}</span>
            </div>
            {/* The modal is short (680px windows): it keeps only the counter. */}
            {!isModal && (
              <ol aria-label={t("setup.steps.aria")} className="mt-2.5 flex flex-wrap gap-1.5">
                {chips.map((step, i) => (
                  <li
                    key={step}
                    aria-current={i === chipIndex ? "step" : undefined}
                    className={cn(
                      "rounded-full px-2.5 py-1 text-[11.5px] font-semibold",
                      i === chipIndex
                        ? "bg-primary text-primary-foreground"
                        : i < chipIndex
                          ? "bg-ok-bg text-ok"
                          : "bg-surface-2 text-muted-foreground"
                    )}
                  >
                    {t(STEP_LABEL[step])}
                  </li>
                ))}
              </ol>
            )}
          </div>
          <button
            type="button"
            aria-label={t("setup.nav.close.aria")}
            onClick={requestClose}
            className="shrink-0 rounded-lg p-2 text-muted-foreground transition-colors duration-fast ease-io hover:bg-surface-2 hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            <X size={18} aria-hidden="true" />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
          <h2
            id="setup-step-title"
            ref={headingRef}
            tabIndex={-1}
            className="text-2xl font-bold tracking-tight text-foreground focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            {t(offer ? "setup.resume.title" : STEP_TITLE[state.step])}
          </h2>
          <div className="mt-4 flex flex-col gap-3">
            {confirmClose && (
              <Alert role="alert" tone="warn">
                <span className="flex flex-col gap-2.5">
                  <span>{t("setup.close.confirm")}</span>
                  <span className="flex flex-wrap gap-2">
                    <Button type="button" variant="outline" onClick={() => setConfirmClose(false)}>
                      {t("setup.close.stay")}
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() => {
                        setConfirmClose(false);
                        onClose();
                      }}
                    >
                      {t("setup.close.leave")}
                    </Button>
                  </span>
                </span>
              </Alert>
            )}
            {fallbackDownloadNotice && <Alert role="alert" tone="warn">{fallbackDownloadNotice}</Alert>}
            {notice && !offer && notice.step === state.step && (
              <Alert role="status" tone="info">{t(notice.key)}</Alert>
            )}
            {body}
          </div>
        </div>

        <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-border-soft px-5 py-3.5">
          <div className="flex items-center gap-2">
            {index > 0 ? (
              <Button type="button" variant="outline" onClick={handleBack}>
                <ArrowLeft size={16} aria-hidden="true" />
                {t("setup.nav.back")}
              </Button>
            ) : (
              isModal && (
                <Button type="button" variant="ghost" onClick={onClose}>
                  {t("setup.nav.skip")}
                </Button>
              )
            )}
          </div>
          <div className="flex min-w-0 items-center gap-3">
            {advanceError && (
              <p role="alert" className="text-xs text-danger">
                {t(advanceError)}
              </p>
            )}
            {isDone ? (
              <Button type="button" variant="primary" onClick={onComplete}>
                {isModal ? t("setup.nav.finish") : t("setup.nav.finishPanel")}
              </Button>
            ) : offer || STEP_OWNS_PRIMARY.has(state.step) ? null : (
              <Button
                type="button"
                variant="primary"
                disabled={!canContinue || advancing}
                onClick={() => void handleNext()}
                className="disabled:cursor-not-allowed disabled:opacity-50"
              >
                {nextLabel}
                {advancing ? (
                  <Loader2 size={16} className="animate-spin motion-reduce:animate-none" aria-hidden="true" />
                ) : (
                  <ArrowRight size={16} aria-hidden="true" />
                )}
              </Button>
            )}
          </div>
        </footer>
        {isModal && <SupportLinks className="border-t border-border-soft px-4 py-1.5" />}
      </div>
    </section>
  );

  if (!isModal) return content;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[color-mix(in_srgb,var(--background)_55%,transparent)] p-4">
      {content}
    </div>
  );
}
