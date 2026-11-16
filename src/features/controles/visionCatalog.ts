import type { ModelDownloadJob } from "../../api/modelDownloads.js";
import type { VisionModelsResponse } from "../../api/vision.js";
import type { TKey, t as translate } from "../../i18n/t.js";

/** Lowercase, without Ollama's implicit `:latest`, so tags compare across spellings. */
export function canonicalTag(tag: string): string {
  return tag.trim().toLowerCase().replace(/:latest$/, "");
}

/*
 * UI-side copy for the backend's static vision catalog
 * (opencohost/core/vision/catalog.py: SUGGESTED_VISION_MODELS desc and
 * VISION_BENCHMARKS note), keyed by canonical tag. The backend text is English;
 * a tag missing here falls back to it verbatim. Keep in sync with catalog.py.
 */
const NOTE_KEYS: Readonly<Record<string, TKey>> = {
  "qwen3-vl:4b-instruct": "controles.vision.catalog.qwen3vl4b.note",
  "qwen3-vl:2b-instruct": "controles.vision.catalog.qwen3vl2b.note",
  "gemma4:e2b": "controles.vision.catalog.gemma4.note",
  "gemma4:e4b": "controles.vision.catalog.gemma4.note",
  "gemma4:12b": "controles.vision.catalog.gemma4.note"
};

const DESC_KEYS: Readonly<Record<string, TKey>> = {
  "qwen3-vl:4b-instruct": "controles.vision.catalog.qwen3vl4b.desc",
  "qwen3-vl:2b-instruct": "controles.vision.catalog.qwen3vl2b.desc"
};

function localized(keys: Readonly<Record<string, TKey>>, tag: string, fallback: string, t: typeof translate): string {
  const key = keys[canonicalTag(tag)];
  return key ? t(key) : fallback;
}

/** Benchmark note for *tag* in the UI locale; the backend note when the tag is unknown. */
export function catalogNote(tag: string, fallback: string, t: typeof translate): string {
  return fallback ? localized(NOTE_KEYS, tag, fallback, t) : fallback;
}

/** Suggested-model description for *tag* in the UI locale; the backend desc when unknown. */
export function catalogDesc(tag: string, fallback: string, t: typeof translate): string {
  return localized(DESC_KEYS, tag, fallback, t);
}

/*
 * Vision-looking names for downloads the catalog does not know yet, e.g. a pull
 * started from "Otro modelo" (the shared HF picker does not record which surface
 * started a job, so origin is not trackable): Qwen-VL / `-vl`, `vision`, LLaVA,
 * Moondream, MiniCPM-V.
 */
const VISION_NAME_RX = /(?:[-_/.]vl(?![a-z])|vision|llava|moondream|minicpm-v)/i;

/**
 * True when a download job is a vision model, so the vision picker never shows a
 * chat-model pull. Order: an installed model the backend reports as non-vision
 * is out; a catalog tag (installed vision model, suggested or benchmarked) is in;
 * otherwise the name decides. Unverified installs (`vision: null`) do not count
 * as catalog tags, only their name can admit them.
 */
export function isVisionDownloadJob(job: Pick<ModelDownloadJob, "tag">, models: VisionModelsResponse | undefined): boolean {
  const tag = canonicalTag(job.tag);
  const installed = models?.installed ?? [];
  if (installed.some((m) => m.vision === false && canonicalTag(m.tag) === tag)) return false;
  const known = [
    ...installed.filter((m) => m.vision === true).map((m) => m.tag),
    ...(models?.suggested ?? []).map((m) => m.tag),
    ...Object.keys(models?.benchmarks ?? {})
  ].map(canonicalTag);
  return known.includes(tag) || VISION_NAME_RX.test(tag);
}
