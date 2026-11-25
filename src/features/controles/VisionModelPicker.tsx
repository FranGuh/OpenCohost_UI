import { useCallback, useState } from "react";
import type { QueryKey } from "@tanstack/react-query";
import type { ModelDownloadJob } from "../../api/modelDownloads.js";
import { useStartModelDownload } from "../../api/modelDownloads.js";
import {
  VISION_MODELS_QUERY_KEY,
  VISION_QUERY_KEY,
  useVisionModelsQuery,
  type VisionResponse
} from "../../api/vision.js";
import { useT } from "../../i18n/t.js";
import { Button } from "../../ui/Button.js";
import { Select, type SelectOption } from "../../ui/Select.js";
import { VisionBenchmarkInfo, benchmarkGlyph } from "./VisionBenchmark.js";
import { HfModelPicker } from "../models/downloads/HfModelPicker.js";
import { ModelDownloadsPanel } from "../models/downloads/ModelDownloadsPanel.js";
import { requestErrorMessage } from "../models/downloads/downloadCopy.js";
import { catalogDesc, isVisionDownloadJob } from "./visionCatalog.js";
import { Disclosure } from "./Disclosure.js";

const INVALIDATE_ON_DOWNLOAD: readonly QueryKey[] = [VISION_QUERY_KEY, VISION_MODELS_QUERY_KEY];

interface VisionModelPickerProps {
  data: VisionResponse | undefined;
  onSelect: (tag: string) => void;
}

/** Vision model selector, suggested downloads and download progress. */
export function VisionModelPicker({ data, onSelect }: VisionModelPickerProps) {
  const t = useT();
  const { data: models } = useVisionModelsQuery();
  const startDownload = useStartModelDownload();
  const [showOther, setShowOther] = useState(false);

  const current = data?.model ?? models?.current ?? "";
  const installed = (models?.installed ?? []).filter((m) => m.vision !== false);
  const installedTags = new Set((models?.installed ?? []).map((m) => m.tag));
  const suggested = (models?.suggested ?? []).filter((m) => !installedTags.has(m.tag));

  const benchmarks = models?.benchmarks ?? {};
  const options: SelectOption[] = installed.map((m) => ({
    value: m.tag,
    label:
      (m.vision === null ? `${m.tag} (${t("controles.vision.model.unverified")})` : m.tag) + benchmarkGlyph(benchmarks[m.tag])
  }));
  // Keep the current model visible even when it is not in the list (not installed / Ollama down).
  if (current && !options.some((o) => o.value === current)) options.unshift({ value: current, label: current + benchmarkGlyph(benchmarks[current]) });
  for (const m of suggested) {
    if (options.some((o) => o.value === m.tag)) continue;
    options.push({ value: m.tag, label: `${m.display} (${t("controles.vision.model.notInstalled")})`, disabled: true });
  }

  // Only vision pulls belong here; chat-model downloads stay in the LLM surfaces.
  const jobFilter = useCallback((job: ModelDownloadJob) => isVisionDownloadJob(job, models), [models]);

  return (
    <div className="flex flex-col gap-2.5">
      <span id="vision-model-label" className="text-xs font-semibold text-foreground">
        {t("controles.vision.model.label")}
      </span>
      <Select
        aria-label={t("controles.vision.model.label")}
        className="mono"
        options={options}
        value={current}
        disabled={!data}
        onChange={(tag) => tag !== current && onSelect(tag)}
      />
      <VisionBenchmarkInfo benchmark={benchmarks[current]} tag={current} testId="vision-bench-current" />
      {benchmarks[current]?.verdict === "broken" && (
        <p role="alert" className="text-[11px] leading-tight text-danger">
          {t("controles.vision.bench.brokenWarning")}
        </p>
      )}
      {models && !models.ollama_reachable && (
        <p className="text-[11px] leading-tight text-dim">{t("controles.vision.model.unreachable")}</p>
      )}
      <Disclosure label={t("controles.provider.editor.advanced.summary")}>
        <div className="flex flex-col gap-2.5">
      {suggested.length > 0 && (
        <ul aria-label={t("controles.vision.model.suggested")} className="flex flex-col gap-2">
          {suggested.map((m) => (
            <li
              key={m.tag}
              className="flex items-center justify-between gap-2.5 rounded-lg border border-white/[0.06] bg-background/40 px-3 py-2.5 text-xs"
            >
              <span className="min-w-0 text-foreground">
                {m.display} <span className="mono text-muted-foreground">{m.size_gb} GB</span>
                <span className="block text-[11px] text-dim">{catalogDesc(m.tag, m.desc, t)}</span>
                <VisionBenchmarkInfo benchmark={benchmarks[m.tag]} tag={m.tag} testId={`vision-bench-${m.tag}`} />
              </span>
              <Button
                type="button"
                variant="outline"
                className="h-7 shrink-0 px-2.5 text-xs"
                disabled={startDownload.isPending}
                aria-label={`${t("controles.vision.model.download")} ${m.display}`}
                onClick={() => startDownload.mutate(m.tag)}
              >
                {t("controles.vision.model.download")}
              </Button>
            </li>
          ))}
        </ul>
      )}
      {startDownload.error && (
        <p role="alert" className="text-xs leading-relaxed text-danger">
          {requestErrorMessage(startDownload.error, t)}
        </p>
      )}
      <ModelDownloadsPanel
        currentModel={current}
        onUseModel={onSelect}
        invalidateKeys={INVALIDATE_ON_DOWNLOAD}
        jobFilter={jobFilter}
      />
      <button
        type="button"
        className="self-start rounded text-[11px] text-muted-foreground underline transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/40"
        aria-expanded={showOther}
        onClick={() => setShowOther((v) => !v)}
      >
        {t("controles.vision.model.other")}
      </button>
      {showOther && <HfModelPicker />}
        </div>
      </Disclosure>
    </div>
  );
}
