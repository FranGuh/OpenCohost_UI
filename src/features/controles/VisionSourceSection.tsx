import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Badge } from "../../ui/Badge.js";
import { Button } from "../../ui/Button.js";
import { Select } from "../../ui/Select.js";
import { Switch } from "../../ui/Switch.js";
import { cn } from "../../lib/cn.js";
import { useT } from "../../i18n/t.js";
import { KeyTestResult } from "../shared/KeyTestResult.js";
import { openExternalUrl } from "../../lib/openUrl.js";
import {
  VISION_QUERY_KEY,
  chatModelReasonKey,
  isChatModelReason,
  type ChatModelReason,
  type VisionResponse,
  type VisionSource,
  type VisionUpdate
} from "../../api/vision.js";
import { useStatusQuery } from "../../api/status.js";
import {
  directVisionAvailability,
  useLlmProvider,
  useLlmProviderPresets,
  useTestLlmProvider,
  useUpdateLlmProvider,
  type LlmProviderResponse,
  type LlmProviderTestResponse,
  type ProviderPreset
} from "../../api/llmProvider.js";
import { VisionModelPicker } from "./VisionModelPicker.js";

interface Props {
  data: VisionResponse | undefined;
  /** Saves a partial update and calls `onSaved` once the backend accepted it. */
  onSave: (updates: VisionUpdate, onSaved?: () => void) => void;
  /** Saves the local vision model tag. */
  onSelectModel: (tag: string) => void;
  pending: boolean;
}

const inputClass =
  "h-9 w-full rounded-md border border-white/[0.08] bg-background/80 px-2.5 text-sm text-foreground placeholder:text-dim transition-colors duration-fast ease-io focus:border-sky-500/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/30 disabled:cursor-not-allowed disabled:opacity-60";

/** The stored source; a backend that only knows the P2 opt-in reads as chat_model. */
export function storedVisionSource(data: VisionResponse | undefined): VisionSource {
  if (data?.vision_source) return data.vision_source;
  return data?.cloud_direct_allowed ? "chat_model" : "local";
}

/** What the UI believes about using the chat model for vision. */
type ChatState =
  | { kind: "checking" }
  | { kind: "error" }
  | { kind: "ok" }
  | { kind: "blocked"; reason: ChatModelReason };

/** Scrolls to and focuses the provider card (it carries `id="provider-card"`). */
function focusProviderCard() {
  const el = document.getElementById("provider-card");
  if (!el) return;
  el.scrollIntoView?.({ behavior: "smooth", block: "start" });
  el.focus({ preventScroll: true });
}

function resolveChatState(
  data: VisionResponse | undefined,
  provider: LlmProviderResponse | undefined,
  presets: Record<string, ProviderPreset>,
  providerError: boolean
): ChatState {
  // The backend verdict is authoritative when present.
  if (data?.chat_model_eligible === true) return { kind: "ok" };
  if (data?.chat_model_eligible === false) {
    const reason = data.chat_model_reason;
    return { kind: "blocked", reason: isChatModelReason(reason) ? reason : "chat_model_requires_cloud_provider" };
  }
  // Older backend: derive it from the provider, but never from a provider that
  // has not loaded (that used to read as "local" and warn about nothing).
  if (providerError) return { kind: "error" };
  if (!provider) return { kind: "checking" };
  const availability = directVisionAvailability(provider, presets);
  if (availability === "ok") return { kind: "ok" };
  return {
    kind: "blocked",
    reason: availability === "local" ? "chat_model_requires_cloud_provider" : "chat_model_not_vision_capable"
  };
}

/**
 * Vision engine selector: describe images on this PC, send them to the cloud chat
 * model, or have a separate cloud model describe them. The engine choice comes
 * first and only the selected engine's pane is rendered. `local` saves at once;
 * `chat_model` saves at once when the backend says it is usable (otherwise it is
 * a draft that explains why); `cloud_model` is a small form saved with one
 * button, because the backend only accepts it complete (provider, model, key).
 */
export function VisionSourceSection({ data, onSave, onSelectModel, pending }: Props) {
  const t = useT();
  const queryClient = useQueryClient();
  const providerQuery = useLlmProvider();
  const statusQuery = useStatusQuery();
  const provider = providerQuery.data;
  const presets = useLlmProviderPresets();
  const testMutation = useTestLlmProvider();
  const providerMutation = useUpdateLlmProvider();

  const [draftSource, setDraftSource] = useState<VisionSource | null>(null);
  const [draftPreset, setDraftPreset] = useState<string | null>(null);
  const [draftModel, setDraftModel] = useState<string | null>(null);
  const [draftUseChatKey, setDraftUseChatKey] = useState<boolean | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [testResult, setTestResult] = useState<LlmProviderTestResponse | null>(null);

  const disabled = !data;
  const stored = storedVisionSource(data);
  const source = draftSource ?? stored;

  const chat = resolveChatState(data, provider, presets, providerQuery.isError);

  // Cloud form: preselect the active provider's preset when nothing is saved yet.
  const activeProfile =
    provider && provider.active_provider !== "local" ? provider.profiles[provider.active_provider] : undefined;
  const savedPreset = data?.vision_cloud_preset ?? "";
  const activePreset = activeProfile?.preset ?? "";
  const preset = draftPreset ?? (savedPreset || activePreset);
  const presetInfo = preset ? presets[preset] : undefined;
  const firstVisionModel = (id: string) => presets[id]?.models.find((m) => m.vision)?.id ?? "";
  const model = draftModel ?? (savedPreset ? (data?.vision_cloud_model ?? "") : firstVisionModel(preset));

  const chatKeyAvailable = Object.values(provider?.profiles ?? {}).some(
    (profile) => profile.preset === preset && profile.api_key_set
  );
  const savedUseChatKey = savedPreset ? (data?.vision_cloud_use_chat_key ?? true) : true;
  const useChatKey = (draftUseChatKey ?? savedUseChatKey) && chatKeyAvailable;
  const ownKeySet = Boolean(data?.vision_cloud_key_set) && preset === savedPreset;
  const hasKey = useChatKey || Boolean(apiKey) || ownKeySet;

  const presetOptions = Object.entries(presets)
    // Providers with no image-capable model on the list are left out; a provider
    // with an empty list (OpenRouter) relies on the live list from the key test.
    .filter(([, p]) => p.models.length === 0 || p.models.some((m) => m.vision))
    .map(([id, p]) => ({ value: id, label: p.label }));

  const visionModels = (presetInfo?.models ?? []).filter((m) => m.vision).map((m) => m.id);
  const modelIds = visionModels.length > 0 ? visionModels : (testResult?.ok ? testResult.models : []);
  const modelOptions = modelIds.map((id) => ({ value: id, label: id }));
  if (model && !modelIds.includes(model)) modelOptions.unshift({ value: model, label: model });

  const canTest = Boolean(preset) && (Boolean(apiKey) || ownKeySet) && !useChatKey && !testMutation.isPending;
  const canSave = Boolean(preset) && Boolean(model) && hasKey && !pending;

  function choose(next: VisionSource) {
    if (next === source) return;
    if (next === "local") {
      setDraftSource(null);
      if (stored !== "local") onSave({ vision_source: "local" });
      return;
    }
    if (next === "cloud_model") {
      setDraftSource("cloud_model");
      return;
    }
    if (chat.kind === "ok") {
      setDraftSource(null);
      onSave({ vision_source: "chat_model" });
    } else {
      setDraftSource("chat_model");
    }
  }

  function useChatModel() {
    setDraftSource(null);
    onSave({ vision_source: "chat_model" });
  }

  function runTest() {
    // Vision key: text-only chat check on the chosen model (a few tokens).
    const base = apiKey ? { preset, api_key: apiKey } : { preset, profile_id: `vision_${preset}` };
    const body = { ...base, check_chat: true, ...(model ? { model } : {}) };
    setTestResult(null);
    testMutation.mutate(body, {
      onSuccess: (result) => setTestResult(result),
      onError: () => setTestResult({ ok: false, error_code: "unreachable", models: [], recommended: [] })
    });
  }

  function save() {
    const updates: VisionUpdate = {
      vision_source: "cloud_model",
      vision_cloud_preset: preset,
      vision_cloud_model: model,
      vision_cloud_use_chat_key: useChatKey
    };
    if (!useChatKey && apiKey) updates.vision_cloud_api_key = apiKey;
    onSave(updates, () => {
      setApiKey("");
      setDraftSource(null);
      setDraftPreset(null);
      setDraftModel(null);
      setDraftUseChatKey(null);
      setTestResult(null);
    });
  }

  function setChatModelSeesImages(next: boolean) {
    const profileId = provider?.active_provider;
    if (!profileId || profileId === "local") return;
    providerMutation.mutate(
      { profile_id: profileId, model_vision: next },
      { onSuccess: () => void queryClient.invalidateQueries({ queryKey: VISION_QUERY_KEY }) }
    );
  }

  const chatModelSubtitle = (() => {
    if (providerQuery.isError) return null;
    if (!provider) return { text: t("controles.vision.chat.checking"), checking: true };
    if (activeProfile) {
      const providerLabel = (activeProfile.preset && presets[activeProfile.preset]?.label) || provider.active_provider;
      return { text: `${providerLabel} · ${activeProfile.model}`, checking: false };
    }
    const ollamaModel = statusQuery.data?.current_model;
    return {
      text: ollamaModel
        ? t("controles.vision.source.chatModel.localLive", { model: ollamaModel })
        : t("controles.vision.source.chatModel.localNoModel"),
      checking: false
    };
  })();

  const options: {
    value: VisionSource;
    label: string;
    badge: string;
    badgeToneClass: string;
    subtitle?: string | null;
    subtitleChecking?: boolean;
    hint: string;
    disabled: boolean;
  }[] = [
    {
      value: "local",
      label: t("controles.vision.source.local"),
      badge: t("controles.vision.source.local.badge"),
      badgeToneClass: "border-emerald-500/25 bg-emerald-500/10 text-emerald-300",
      hint: t("controles.vision.source.local.hint"),
      disabled: disabled
    },
    {
      value: "chat_model",
      label: t("controles.vision.source.chatModel"),
      badge: t("controles.vision.source.chatModel.badge"),
      badgeToneClass: "border-sky-500/25 bg-sky-500/10 text-sky-300",
      subtitle: chatModelSubtitle?.text ?? null,
      subtitleChecking: chatModelSubtitle?.checking ?? false,
      hint: t("controles.vision.source.chatModel.hint"),
      disabled: disabled || chat.kind === "checking"
    },
    {
      value: "cloud_model",
      label: t("controles.vision.source.cloudModel"),
      badge: t("controles.vision.source.cloudModel.badge"),
      badgeToneClass: "border-indigo-500/25 bg-indigo-500/10 text-indigo-300",
      hint: t("controles.vision.source.cloudModel.hint"),
      disabled: disabled
    }
  ];

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-white/[0.06] bg-surface-2/35 p-3">
      <span id="vision-source-label" className="text-xs font-semibold text-foreground">
        {t("controles.vision.source.label")}
      </span>
      <div role="radiogroup" aria-labelledby="vision-source-label" className="flex flex-col gap-2">
        {options.map((option) => {
          const selected = source === option.value;
          return (
            <label
              key={option.value}
              data-selected={selected ? "true" : "false"}
              className={cn(
                "group relative flex items-start gap-3 rounded-xl border p-3 transition-all duration-fast ease-io",
                "has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-sky-500/35",
                option.disabled
                  ? "cursor-not-allowed border-white/[0.04] bg-surface-2/25 opacity-55"
                  : selected
                    ? "cursor-pointer border-sky-500/40 bg-sky-500/10 shadow-[0_0_20px_-6px_rgba(56,189,248,0.22)]"
                    : "cursor-pointer border-white/[0.06] bg-background/40 hover:border-slate-700/80 hover:bg-surface-2/60"
              )}
            >
              <input
                type="radio"
                name="vision-source"
                value={option.value}
                checked={selected}
                disabled={option.disabled}
                onChange={() => choose(option.value)}
                className="sr-only peer"
              />
              <span
                aria-hidden="true"
                className={cn(
                  "mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border transition-all duration-fast ease-io",
                  "peer-focus-visible:ring-2 peer-focus-visible:ring-sky-400/50",
                  selected
                    ? "border-sky-400/80 bg-sky-500/15 shadow-[0_0_10px_rgba(56,189,248,0.3)]"
                    : "border-slate-700/90 bg-background/70 group-hover:border-slate-600"
                )}
              >
                <span
                  className={cn(
                    "h-2 w-2 rounded-full transition-transform duration-fast ease-io",
                    selected
                      ? "scale-100 bg-sky-400 shadow-[0_0_8px_rgba(56,189,248,0.85)]"
                      : "scale-0 bg-transparent"
                  )}
                />
              </span>
              <span className="flex min-w-0 flex-1 flex-col gap-1">
                <span className="flex flex-wrap items-center justify-between gap-2">
                  <span className={cn("text-[13px] font-semibold leading-snug", selected ? "text-foreground" : "text-foreground/90")}>
                    {option.label}
                  </span>
                  <span
                    className={cn(
                      "inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium tracking-wide",
                      option.badgeToneClass
                    )}
                  >
                    {option.badge}
                  </span>
                </span>
                {option.subtitle && (
                  <span
                    role={option.subtitleChecking ? "status" : undefined}
                    className="mono text-[11px] leading-snug text-muted-foreground"
                  >
                    {option.subtitle}
                  </span>
                )}
                <span className="text-[11.5px] leading-relaxed text-muted-foreground">{option.hint}</span>
              </span>
            </label>
          );
        })}
      </div>

      {source === "local" && (
        <div className="flex flex-col gap-2.5 rounded-lg border border-white/[0.06] bg-background/40 p-3">
          <VisionModelPicker data={data} onSelect={onSelectModel} />
          {data?.chat_model_eligible === true && (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-sky-500/20 bg-sky-500/5 px-2.5 py-2">
              <p className="min-w-0 flex-1 text-[11px] leading-snug text-muted-foreground">
                {t("controles.vision.suggest.chatModel")}
              </p>
              <Button
                type="button"
                variant="outline"
                className="h-7 shrink-0 px-2.5 text-xs"
                disabled={pending}
                onClick={useChatModel}
              >
                {t("controles.vision.suggest.chatModel.action")}
              </Button>
            </div>
          )}
          {data?.vram_warning === "insufficient" && data.vram_needed_gib != null && (
            <p className="rounded-lg border border-warn/20 bg-warn/5 px-2.5 py-2 text-[11px] leading-snug text-warn">
              {data.vram_free_gib != null && data.vram_total_gib != null
                ? t("controles.vision.vram.insufficient", {
                    needed: data.vram_needed_gib.toFixed(1),
                    free: data.vram_free_gib.toFixed(1),
                    total: data.vram_total_gib.toFixed(1)
                  })
                : t("controles.vision.vram.insufficientNoFree", { needed: data.vram_needed_gib.toFixed(1) })}
            </p>
          )}
          {data?.vram_warning === "unknown" && (
            <p className="text-[11px] leading-snug text-dim">{t("controles.vision.vram.unknown")}</p>
          )}
        </div>
      )}

      {source === "chat_model" && (
        <div className="flex flex-col gap-2.5 rounded-lg border border-white/[0.06] bg-background/40 p-3">
          {chat.kind === "checking" && !chatModelSubtitle?.checking && (
            <p role="status" className="text-[11px] leading-snug text-dim">
              {t("controles.vision.chat.checking")}
            </p>
          )}
          {chat.kind === "error" && (
            <p className="text-[11px] leading-snug text-warn">{t("controles.vision.chat.error")}</p>
          )}
          {provider && activeProfile && (
            <div className="flex flex-wrap items-center gap-2 text-[13px] text-foreground">
              <span className="font-semibold">
                {(activeProfile.preset && presets[activeProfile.preset]?.label) || provider.active_provider}
              </span>
              <span className="mono text-xs text-muted-foreground">{activeProfile.model}</span>
              {chat.kind === "ok" && <Badge tone="info">{t("controles.provider.editor.vision.badge")}</Badge>}
              {activeProfile.api_key_set && (
                <Badge tone="neutral">{t("controles.provider.editor.apiKey.savedBadge")}</Badge>
              )}
            </div>
          )}
          {chat.kind === "blocked" && (
            <p className="rounded-lg border border-warn/20 bg-warn/5 px-2.5 py-2 text-[11px] leading-snug text-warn">
              {t(chatModelReasonKey(chat.reason))}
            </p>
          )}
          {chat.kind === "blocked" && chat.reason === "chat_model_not_vision_capable" && activeProfile && (
            <div className="grid grid-cols-[1fr_auto] items-center gap-3">
              <span className="text-[13px] text-foreground">{t("controles.provider.editor.modelVision.label")}</span>
              <Switch
                checked={activeProfile.model_vision === true}
                disabled={providerMutation.isPending}
                onChange={setChatModelSeesImages}
                aria-label={t("controles.provider.editor.modelVision.label")}
              />
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" variant="outline" onClick={focusProviderCard}>
              {t("controles.vision.chat.changeLink")}
            </Button>
            {draftSource === "chat_model" && chat.kind === "ok" && (
              <Button type="button" variant="primary" disabled={pending} onClick={useChatModel}>
                {t("controles.vision.suggest.chatModel.action")}
              </Button>
            )}
          </div>
        </div>
      )}

      {source === "cloud_model" && (
        <div className="flex flex-col gap-3 rounded-lg border border-white/[0.06] bg-background/40 p-3">
          <div className="flex flex-col gap-1.5">
            <span id="vision-cloud-preset-label" className="text-[13px] text-foreground">
              {t("controles.vision.cloud.provider")}
            </span>
            <Select
              options={[{ value: "", label: t("controles.provider.editor.preset.none") }, ...presetOptions]}
              value={preset}
              onChange={(next) => {
                setDraftPreset(next);
                setDraftModel(next ? firstVisionModel(next) : "");
                setDraftUseChatKey(false);
                setApiKey("");
                setTestResult(null);
              }}
              aria-labelledby="vision-cloud-preset-label"
            />
            {presetInfo?.key_url && (
              <div>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => {
                    void openExternalUrl(presetInfo.key_url);
                  }}
                >
                  {t("controles.provider.editor.getKey.action")}
                </Button>
              </div>
            )}
          </div>

          {chatKeyAvailable && (
            <div className="grid grid-cols-[1fr_auto] items-center gap-3 rounded-lg border border-white/[0.06] bg-surface-2/30 px-3 py-2">
              <span className="text-[13px] text-foreground">{t("controles.vision.cloud.useChatKey")}</span>
              <Switch
                checked={useChatKey}
                onChange={setDraftUseChatKey}
                aria-label={t("controles.vision.cloud.useChatKey")}
              />
            </div>
          )}

          {!useChatKey && (
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between gap-2">
                <label htmlFor="vision-cloud-api-key" className="text-[13px] text-foreground">
                  {t("controles.provider.editor.apiKey.label")}
                </label>
                {ownKeySet && <Badge tone="neutral">{t("controles.provider.editor.apiKey.savedBadge")}</Badge>}
              </div>
              <input
                id="vision-cloud-api-key"
                type="password"
                autoComplete="off"
                value={apiKey}
                onChange={(event) => {
                  setApiKey(event.target.value);
                  setTestResult(null);
                }}
                placeholder={
                  ownKeySet
                    ? t("controles.provider.editor.apiKey.placeholder.change")
                    : t("controles.provider.editor.apiKey.placeholder.new")
                }
                className={inputClass}
              />
              <p className="text-[11px] leading-relaxed text-dim">{t("controles.provider.editor.apiKey.hint")}</p>
              <div className="flex items-center gap-2">
                <Button type="button" variant="outline" disabled={!canTest} onClick={runTest}>
                  {testMutation.isPending
                    ? t("controles.provider.editor.test.pending")
                    : t("controles.provider.editor.test.action")}
                </Button>
                {testResult && <KeyTestResult result={testResult} />}
              </div>
              <p className="text-[11px] leading-relaxed text-dim">{t("keytest.notice")}</p>
            </div>
          )}

          <div className="flex flex-col gap-1.5">
            <span id="vision-cloud-model-label" className="text-[13px] text-foreground">
              {t("controles.vision.cloud.model")}
            </span>
            {modelOptions.length > 0 ? (
              <Select
                options={modelOptions}
                value={model}
                onChange={setDraftModel}
                aria-labelledby="vision-cloud-model-label"
              />
            ) : (
              <p className="text-[11px] leading-relaxed text-dim">{t("controles.vision.cloud.modelsHint")}</p>
            )}
          </div>

          <div>
            <Button type="button" variant="primary" disabled={!canSave} onClick={save}>
              {t("controles.vision.cloud.save")}
            </Button>
          </div>
        </div>
      )}

      {source !== "local" && (
        <p className="text-[11px] leading-relaxed text-dim">{t("controles.vision.source.privacy")}</p>
      )}
    </div>
  );
}
