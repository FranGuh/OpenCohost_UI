import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { KeyRound, Loader2, Plus } from "lucide-react";
import { getLlmReadiness, type LlmReadinessResponse } from "../../api/client.js";
import {
  LLM_PROVIDER_PRESETS,
  suggestDuplicateId,
  postLlmProviderTest,
  useLlmProvider,
  useUpdateLlmProvider,
  type LlmProviderTestResponse,
  type LlmProviderProfile,
  type LlmProviderRequest
} from "../../api/llmProvider.js";
import { LLM_READINESS_QUERY_KEY } from "../shared/useLlmReadiness.js";
import { keyTestOutcome, testErrorToResponse } from "../shared/keyTestOutcome.js";
import { Badge } from "../../ui/Badge.js";
import { Button } from "../../ui/Button.js";
import { Input } from "../../ui/Input.js";
import { Segmented } from "../../ui/Segmented.js";
import { Switch } from "../../ui/Switch.js";
import { useT, type TKey } from "../../i18n/t.js";
import { cn } from "../../lib/cn.js";
import type { LocalOllamaAvailability, StepProps } from "./SetupSteps.js";

/** Default model per built-in preset (same defaults LlmReadinessCard uses). */
const DEFAULT_MODEL: Record<string, string> = {
  openai: "gpt-4o-mini",
  nvidia_nim: "meta/llama-3.1-70b-instruct"
};

type KeyStatus = "idle" | "validating" | "ok" | "invalid" | "unreachable" | "saveError" | "testFailed" | "forced";
type ValidationPhase = "saving" | "auth" | "chat";

/** Failures after which the user may keep going anyway (not a failed save: nothing was stored). */
const SKIPPABLE: KeyStatus[] = ["invalid", "unreachable", "testFailed"];

const STATUS_COPY: Partial<Record<KeyStatus, { key: TKey; className: string }>> = {
  ok: { key: "setup.apiKey.ok", className: "text-ok" },
  invalid: { key: "setup.apiKey.invalid", className: "text-danger" },
  unreachable: { key: "setup.apiKey.unreachable", className: "text-warn" },
  saveError: { key: "setup.apiKey.saveError", className: "text-danger" }
};

/** "list": saved profiles; "edit": one saved profile's form; "new": the create form. */
type Mode = { kind: "list" } | { kind: "edit"; id: string; needsKey: boolean } | { kind: "new" };

const LABEL = "text-[11px] font-semibold uppercase tracking-[0.09em] text-dim";

export interface FallbackStepProps {
  fallback: boolean;
  onFallbackChange(value: boolean): void;
  ollamaAvailability: LocalOllamaAvailability;
}

/** Cloud path, its own screen: keep a small local model as a backup (one switch; off by default). */
export function FallbackStep({ fallback, onFallbackChange, ollamaAvailability }: FallbackStepProps) {
  const t = useT();
  const unavailable = ollamaAvailability === "missing" || ollamaAvailability === "offline";
  const copyKey: TKey =
    ollamaAvailability === "missing"
      ? "setup.apiKey.fallbackUnavailable.missing"
      : ollamaAvailability === "offline"
        ? "setup.apiKey.fallbackUnavailable.offline"
        : "setup.apiKey.fallback";
  return (
    <div className="flex max-w-xl flex-col gap-4">
      <p className="text-sm leading-relaxed text-muted-foreground">{t("setup.fallback.copy")}</p>
      {/* A button is a labelable element: clicking the visible text toggles the switch too. */}
      <label className="flex cursor-pointer items-start gap-3 text-sm text-foreground">
        <Switch checked={fallback} onChange={onFallbackChange} disabled={unavailable} aria-label={t(copyKey)} className="mt-0.5" />
        <span>{t(copyKey)}</span>
      </label>
    </div>
  );
}

/**
 * BYOK step. Saved profiles (GET /api/llm/provider, which only ever reports
 * `api_key_set`) come first: use one as is, or edit its base URL / model /
 * key, where an empty key field keeps the stored key. "Nuevo proveedor" is the
 * create path. Every write is a PUT /api/llm/provider (the key rides only in
 * that request body and is scrubbed by useUpdateLlmProvider) and the input is
 * cleared right after. Validation is one fresh GET /api/llm/readiness: its
 * probe makes a real authenticated call to the provider's /models. POST
 * /api/llm/provider/probe is NOT used — it only re-arms the fallback engine.
 */
export function CloudKeyStep({ state, dispatch }: StepProps) {
  const t = useT();
  const queryClient = useQueryClient();
  const { data: provider } = useLlmProvider();
  const updateProvider = useUpdateLlmProvider();
  const profiles = provider?.profiles ?? {};
  const profileIds = Object.keys(profiles);

  // null = not chosen yet: the list when profiles exist, otherwise the create form.
  const [chosenMode, setChosenMode] = useState<Mode | null>(null);
  const mode: Mode = chosenMode ?? (profileIds.length > 0 ? { kind: "list" } : { kind: "new" });

  const [preset, setPreset] = useState(state.cloud?.preset ?? "openai");
  const [baseUrl, setBaseUrl] = useState("");
  const [model, setModel] = useState(state.cloud?.model ?? DEFAULT_MODEL.openai);
  const [apiKey, setApiKey] = useState("");
  const [status, setStatus] = useState<KeyStatus>(state.cloud ? "ok" : "idle");
  const [validationPhase, setValidationPhase] = useState<ValidationPhase | null>(null);
  const [validatingProfileId, setValidatingProfileId] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<LlmProviderTestResponse | null>(null);
  const [errorDetail, setErrorDetail] = useState<string | null>(null);
  const [pending, setPending] = useState<{ preset: string; model: string } | null>(null);
  const validationSeq = useRef(0);

  function invalidate() {
    validationSeq.current += 1;
    if (status !== "idle") setStatus("idle");
    setValidationPhase(null);
    setValidatingProfileId(null);
    setTestResult(null);
    setErrorDetail(null);
    setPending(null);
    if (state.cloud) dispatch({ type: "cloudInvalidated" });
  }

  function openMode(next: Mode) {
    setApiKey("");
    invalidate();
    setChosenMode(next);
  }

  function openEdit(id: string, profile: LlmProviderProfile) {
    setBaseUrl(profile.base_url);
    setModel(profile.model);
    openMode({ kind: "edit", id, needsKey: !profile.api_key_set });
  }

  function openNew() {
    setPreset("openai");
    setModel(DEFAULT_MODEL.openai);
    openMode({ kind: "new" });
  }

  function handlePreset(next: string) {
    setPreset(next);
    setModel(DEFAULT_MODEL[next] ?? "");
    invalidate();
  }

  /** One PUT, then readiness + provider/test so failures always surface HTTP/provider/timeout details. */
  async function saveAndValidate(body: LlmProviderRequest, validated: { preset: string; model: string }) {
    if (status === "validating") return;
    const seq = ++validationSeq.current;
    const profileId = body.profile_id ?? body.active_provider ?? "";
    setStatus("validating");
    setValidationPhase("saving");
    setValidatingProfileId(profileId || null);
    setTestResult(null);
    setErrorDetail(null);
    setPending(validated);
    try {
      await updateProvider.mutateAsync(body);
    } catch (err) {
      if (validationSeq.current !== seq) return;
      setErrorDetail(testErrorToResponse(err, t).provider_message ?? null);
      setValidationPhase(null);
      setValidatingProfileId(null);
      setStatus("saveError");
      return;
    } finally {
      // Saved or not, the key leaves component state immediately.
      setApiKey("");
    }
    if (validationSeq.current !== seq) return;

    setValidationPhase("auth");
    let readiness: LlmReadinessResponse | null = null;
    let readinessError: unknown = null;
    try {
      readiness = await queryClient.fetchQuery({
        queryKey: LLM_READINESS_QUERY_KEY,
        queryFn: getLlmReadiness,
        staleTime: 0
      });
    } catch (err) {
      readinessError = err;
    }
    if (validationSeq.current !== seq) return;

    setValidationPhase("chat");
    const request = { profile_id: profileId, model: validated.model, check_chat: true as const };
    let result: LlmProviderTestResponse | null = null;
    let testError: unknown = null;
    try {
      result = await postLlmProviderTest(validated.preset ? { ...request, preset: validated.preset } : request);
    } catch (err) {
      testError = err;
    }
    if (validationSeq.current !== seq) return;

    setValidationPhase(null);
    setValidatingProfileId(null);

    if (readiness?.state === "CLOUD_READY") {
      if (result && result.ok && result.chat_ok === true) {
        setStatus("ok");
        dispatch({ type: "cloudValidated", ...validated });
      } else {
        setTestResult(result ?? testErrorToResponse(testError, t));
        setStatus("testFailed");
      }
      return;
    }

    if (result && (!result.ok || result.chat_ok === false)) {
      setTestResult(result);
      setStatus("testFailed");
      return;
    }

    if (testError) {
      setTestResult(testErrorToResponse(testError, t));
      setStatus("testFailed");
      return;
    }

    if (readiness && (readiness.state === "CLOUD_INVALID_CREDENTIALS" || readiness.state === "CLOUD_UNCONFIGURED")) {
      setErrorDetail(typeof readiness.cloud?.error === "string" ? readiness.cloud.error : null);
      setStatus("invalid");
      return;
    }

    const fallbackDetail = readinessError
      ? testErrorToResponse(readinessError, t).provider_message ?? null
      : typeof readiness?.cloud?.error === "string"
        ? readiness.cloud.error
        : null;
    setErrorDetail(fallbackDetail);
    setStatus("unreachable");
  }

  function handleUse(id: string, profile: LlmProviderProfile) {
    if (!profile.api_key_set) {
      openEdit(id, profile);
      return;
    }
    void saveAndValidate({ active_provider: id }, { preset: profile.preset, model: profile.model });
  }

  function handleSaveEdit(id: string, profile: LlmProviderProfile) {
    const key = apiKey.trim();
    const body: LlmProviderRequest = {
      active_provider: id,
      profile_id: id,
      base_url: baseUrl.trim() || profile.base_url,
      model: model.trim() || profile.model
    };
    // An empty key field keeps the stored key: api_key is simply not sent.
    if (key) body.api_key = key;
    void saveAndValidate(body, { preset: profile.preset, model: body.model ?? profile.model });
  }

  function handleCreate() {
    const key = apiKey.trim();
    if (!key) return;
    const chosenModel = model.trim() || DEFAULT_MODEL[preset] || "";
    // Never overwrite a saved profile that happens to share the preset's id.
    const id = profiles[preset] ? suggestDuplicateId(preset, profileIds) : preset;
    void saveAndValidate(
      { active_provider: id, profile_id: id, preset, model: chosenModel, api_key: key },
      { preset, model: chosenModel }
    );
  }

  const message = STATUS_COPY[status];
  const validating = status === "validating";
  const outcome = status === "testFailed" && testResult ? keyTestOutcome(testResult, t) : null;
  const phaseCopy =
    validationPhase === "saving"
      ? t("setup.apiKey.phase.saving")
      : validationPhase === "chat"
        ? pending?.model
          ? t("setup.apiKey.phase.chat", { model: pending.model })
          : t("setup.apiKey.phase.chatGeneric")
        : t("setup.apiKey.phase.auth");
  const detailText = outcome?.detail ?? errorDetail;
  const statusLine = (
    <div className="flex flex-col gap-2">
      <p
        aria-live="polite"
        className={cn("min-h-5 text-sm", validating ? "text-info" : outcome ? "text-warn" : message?.className)}
      >
        {validating ? (
          <span className="inline-flex items-center gap-2">
            <Loader2 size={14} className="shrink-0 animate-spin motion-reduce:animate-none" aria-hidden="true" />
            <span>{phaseCopy}</span>
          </span>
        ) : outcome ? (
          outcome.line
        ) : message ? (
          t(message.key)
        ) : (
          ""
        )}
      </p>
      {detailText && <p className="mono break-words text-xs text-muted-foreground">{detailText}</p>}
      {SKIPPABLE.includes(status) && pending && (
        <Button
          type="button"
          variant="ghost"
          className="self-start"
          onClick={() => {
            setStatus("forced");
            dispatch({ type: "cloudValidated", ...pending });
          }}
        >
          {t("setup.apiKey.continueAnyway")}
        </Button>
      )}
    </div>
  );

  const keyField = (hintKey: TKey) => (
    <div className="flex flex-col gap-2">
      <label htmlFor="setup-cloud-key" className={LABEL}>
        {t("setup.apiKey.key")}
      </label>
      <Input
        id="setup-cloud-key"
        type="password"
        value={apiKey}
        placeholder="sk-…"
        autoComplete="off"
        spellCheck={false}
        aria-describedby="setup-cloud-key-hint"
        onChange={(event) => {
          setApiKey(event.target.value);
          invalidate();
        }}
      />
      <p id="setup-cloud-key-hint" className="text-xs leading-relaxed text-muted-foreground">
        {t(hintKey)}
      </p>
      <p className="text-xs leading-relaxed text-muted-foreground">{t("keytest.notice")}</p>
    </div>
  );

  const modelField = (placeholder?: string) => (
    <div className="flex flex-col gap-2">
      <label htmlFor="setup-cloud-model" className={LABEL}>
        {t("setup.apiKey.model")}
      </label>
      <Input
        id="setup-cloud-model"
        value={model}
        placeholder={placeholder}
        onChange={(event) => {
          setModel(event.target.value);
          invalidate();
        }}
        autoComplete="off"
        spellCheck={false}
      />
    </div>
  );

  let body;
  if (mode.kind === "list") {
    body = (
      <div className="flex flex-col gap-3">
        <h3 id="setup-cloud-profiles" className={LABEL}>
          {t("setup.apiKey.profiles.title")}
        </h3>
        <ul role="group" aria-labelledby="setup-cloud-profiles" className="flex flex-col gap-2">
          {Object.entries(profiles).map(([id, profile]) => (
            <li
              key={id}
              className="flex flex-wrap items-center gap-3 rounded-md border border-border-soft bg-surface-2 px-3.5 py-3"
            >
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-bold text-foreground">{id}</span>
                  {provider?.active_provider === id && (
                    <Badge tone="info" className="px-2 py-0.5 text-[11px]">
                      {t("setup.apiKey.profile.active")}
                    </Badge>
                  )}
                </p>
                <p className="mono truncate text-xs text-muted-foreground">
                  {profile.model} ·{" "}
                  {profile.api_key_set ? t("setup.apiKey.profile.keySaved") : t("setup.apiKey.profile.noKey")}
                </p>
              </div>
              <div className="flex shrink-0 gap-2">
                {(() => {
                  const isThisValidating = validating && validatingProfileId === id;
                  return (
                    <Button
                      type="button"
                      variant="primary"
                      disabled={validating}
                      aria-label={
                        isThisValidating
                          ? t("setup.apiKey.profile.validating", { name: id })
                          : t("setup.apiKey.profile.use", { name: id })
                      }
                      onClick={() => handleUse(id, profile)}
                      className="h-8 px-3 text-xs disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {isThisValidating && (
                        <Loader2 size={12} className="animate-spin motion-reduce:animate-none" aria-hidden="true" />
                      )}
                      {isThisValidating ? t("setup.apiKey.validating") : t("setup.apiKey.profile.useShort")}
                    </Button>
                  );
                })()}
                <Button
                  type="button"
                  variant="outline"
                  aria-label={t("setup.apiKey.profile.edit", { name: id })}
                  onClick={() => openEdit(id, profile)}
                  className="h-8 px-3 text-xs"
                >
                  {t("setup.apiKey.profile.editShort")}
                </Button>
              </div>
            </li>
          ))}
        </ul>
        {statusLine}
        <Button type="button" variant="outline" onClick={openNew} className="self-start">
          <Plus size={14} aria-hidden="true" />
          {t("setup.apiKey.new")}
        </Button>
      </div>
    );
  } else if (mode.kind === "edit") {
    const profile = profiles[mode.id];
    body = profile ? (
      <div className="flex flex-col gap-4">
        <h3 className="text-sm font-bold text-foreground">{t("setup.apiKey.profile.editTitle", { name: mode.id })}</h3>
        {mode.needsKey && <p className="text-sm text-warn">{t("setup.apiKey.profile.needsKey")}</p>}
        <div className="flex flex-col gap-2">
          <label htmlFor="setup-cloud-base-url" className={LABEL}>
            {t("setup.apiKey.baseUrl")}
          </label>
          <Input
            id="setup-cloud-base-url"
            value={baseUrl}
            onChange={(event) => {
              setBaseUrl(event.target.value);
              invalidate();
            }}
            autoComplete="off"
            spellCheck={false}
          />
        </div>
        {modelField()}
        {keyField(profile.api_key_set ? "setup.apiKey.keyKeep" : "setup.apiKey.keyHint")}
        <div className="flex flex-wrap items-center gap-3">
          <Button
            type="button"
            variant="primary"
            disabled={validating || (!profile.api_key_set && !apiKey.trim())}
            onClick={() => handleSaveEdit(mode.id, profile)}
            className="disabled:cursor-not-allowed disabled:opacity-50"
          >
            {validating ? (
              <Loader2 size={14} className="animate-spin motion-reduce:animate-none" aria-hidden="true" />
            ) : (
              <KeyRound size={14} aria-hidden="true" />
            )}
            {validating ? t("setup.apiKey.validating") : t("setup.apiKey.saveValidate")}
          </Button>
          <Button type="button" variant="ghost" onClick={() => openMode({ kind: "list" })}>
            {t("setup.apiKey.cancel")}
          </Button>
        </div>
        {statusLine}
      </div>
    ) : null;
  } else {
    body = (
      <div className="flex flex-col gap-4">
        {profileIds.length > 0 && <h3 className="text-sm font-bold text-foreground">{t("setup.apiKey.newTitle")}</h3>}
        <div className="flex flex-col gap-2">
          <span className={LABEL}>{t("setup.apiKey.provider")}</span>
          <Segmented
            ariaLabel={t("setup.apiKey.provider")}
            value={preset}
            onChange={handlePreset}
            options={Object.entries(LLM_PROVIDER_PRESETS).map(([id, info]) => ({ value: id, label: info.label }))}
            className="self-start"
          />
        </div>
        {modelField(DEFAULT_MODEL[preset])}
        {keyField("setup.apiKey.keyHint")}
        <div className="flex flex-wrap items-center gap-3">
          <Button
            type="button"
            variant="primary"
            disabled={!apiKey.trim() || validating}
            onClick={handleCreate}
            className="disabled:cursor-not-allowed disabled:opacity-50"
          >
            {validating ? (
              <Loader2 size={14} className="animate-spin motion-reduce:animate-none" aria-hidden="true" />
            ) : (
              <KeyRound size={14} aria-hidden="true" />
            )}
            {validating ? t("setup.apiKey.validating") : t("setup.apiKey.validate")}
          </Button>
          {profileIds.length > 0 && (
            <Button type="button" variant="ghost" onClick={() => openMode({ kind: "list" })}>
              {t("setup.apiKey.cancel")}
            </Button>
          )}
        </div>
        {statusLine}
      </div>
    );
  }

  return <div className="flex flex-col gap-5">{body}</div>;
}
