import { useState } from "react";
import { Check } from "lucide-react";
import { Badge } from "../../ui/Badge.js";
import { Button } from "../../ui/Button.js";
import { Select } from "../../ui/Select.js";
import { cn } from "../../lib/cn.js";
import { useT } from "../../i18n/t.js";
import { KeyTestResult } from "../shared/KeyTestResult.js";
import { openExternalUrl } from "../../lib/openUrl.js";
import type { VisionResponse, VisionSource, VisionUpdate } from "../../api/vision.js";
import {
  directVisionAvailability,
  useLlmProvider,
  useLlmProviderPresets,
  useTestLlmProvider,
  type LlmProviderTestResponse
} from "../../api/llmProvider.js";

interface Props {
  data: VisionResponse | undefined;
  /** Saves a partial update and calls `onSaved` once the backend accepted it. */
  onSave: (updates: VisionUpdate, onSaved?: () => void) => void;
  pending: boolean;
}

const inputClass =
  "h-9 w-full rounded-md border border-white/[0.08] bg-background/80 px-2.5 text-sm text-foreground placeholder:text-dim transition-colors duration-fast ease-io focus:border-sky-500/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/30 disabled:cursor-not-allowed disabled:opacity-60";

/** The stored source; a backend that only knows the P2 opt-in reads as chat_model. */
function storedSource(data: VisionResponse | undefined): VisionSource {
  if (data?.vision_source) return data.vision_source;
  return data?.cloud_direct_allowed ? "chat_model" : "local";
}

/**
 * Vision source selector: describe images on this PC, send them to the cloud chat
 * model, or have a separate cloud model describe them. `local` and `chat_model`
 * save at once; `cloud_model` is a small form saved with one button, because the
 * backend only accepts it complete (provider, model and a key).
 */
export function VisionSourceSection({ data, onSave, pending }: Props) {
  const t = useT();
  const { data: provider } = useLlmProvider();
  const presets = useLlmProviderPresets();
  const testMutation = useTestLlmProvider();
  const chatAvailability = directVisionAvailability(provider, presets);

  const [draftSource, setDraftSource] = useState<VisionSource | null>(null);
  const [draftPreset, setDraftPreset] = useState<string | null>(null);
  const [draftModel, setDraftModel] = useState<string | null>(null);
  const [draftUseChatKey, setDraftUseChatKey] = useState<boolean | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [testResult, setTestResult] = useState<LlmProviderTestResponse | null>(null);

  const disabled = !data;
  const source = draftSource ?? storedSource(data);
  const preset = draftPreset ?? data?.vision_cloud_preset ?? "";
  const model = draftModel ?? data?.vision_cloud_model ?? "";
  const presetInfo = preset ? presets[preset] : undefined;

  const chatKeyAvailable = Object.values(provider?.profiles ?? {}).some(
    (profile) => profile.preset === preset && profile.api_key_set
  );
  const useChatKey = (draftUseChatKey ?? data?.vision_cloud_use_chat_key ?? true) && chatKeyAvailable;
  const ownKeySet = Boolean(data?.vision_cloud_key_set) && preset === (data?.vision_cloud_preset ?? "");
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
    if (next === "cloud_model") {
      setDraftSource("cloud_model");
      return;
    }
    setDraftSource(null);
    onSave({ vision_source: next });
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

  const options: {
    value: VisionSource;
    label: string;
    badge: string;
    badgeToneClass: string;
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
      hint: t("controles.vision.source.chatModel.hint"),
      disabled: disabled || chatAvailability !== "ok"
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
                <span className="text-[11.5px] leading-relaxed text-muted-foreground">{option.hint}</span>
              </span>
            </label>
          );
        })}
      </div>

      {chatAvailability !== "ok" && (
        <p className="rounded-lg border border-warn/20 bg-warn/5 px-2.5 py-2 text-[11px] leading-snug text-warn">
          {chatAvailability === "local"
            ? t("controles.vision.cloudDirect.needsCloud")
            : t("controles.vision.cloudDirect.noVision")}
        </p>
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
                setDraftModel(next ? (presets[next]?.models.find((m) => m.vision)?.id ?? "") : "");
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
            <label className="group flex cursor-pointer items-center gap-2.5 rounded-lg border border-white/[0.06] bg-surface-2/30 px-3 py-2 text-[13px] text-foreground transition-colors duration-fast ease-io hover:border-slate-700/80 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-sky-500/35">
              <input
                type="checkbox"
                checked={useChatKey}
                onChange={(event) => setDraftUseChatKey(event.target.checked)}
                className="sr-only peer"
              />
              <span
                aria-hidden="true"
                className={cn(
                  "flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors duration-fast ease-io",
                  "peer-focus-visible:ring-2 peer-focus-visible:ring-sky-400/50",
                  useChatKey
                    ? "border-sky-400/80 bg-sky-500/20 text-sky-300"
                    : "border-slate-700/90 bg-background/70 text-transparent group-hover:border-slate-600"
                )}
              >
                <Check className="h-3 w-3" strokeWidth={2.5} />
              </span>
              <span>{t("controles.vision.cloud.useChatKey")}</span>
            </label>
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
