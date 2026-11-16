import { useId, useState, type FormEvent } from "react";
import { Loader2 } from "lucide-react";
import {
  formatBytes,
  normalizeHfRepo,
  useHfQuantsQuery,
  useStartModelDownload,
  type HfRepoRef,
  type HfVramFit
} from "../../../api/modelDownloads.js";
import { Badge, type BadgeTone } from "../../../ui/Badge.js";
import { Button } from "../../../ui/Button.js";
import { Input } from "../../../ui/Input.js";
import { useT, type TKey } from "../../../i18n/t.js";
import { hfErrorMessage, requestErrorMessage } from "./downloadCopy.js";

const FIT_KEYS: Record<HfVramFit, TKey> = {
  fits: "models.hf.fit.fits",
  tight: "models.hf.fit.tight",
  too_large: "models.hf.fit.too_large",
  unknown: "models.hf.fit.unknown"
};

const FIT_TONES: Record<HfVramFit, BadgeTone> = {
  fits: "ok",
  tight: "warn",
  too_large: "danger",
  unknown: "neutral"
};

/**
 * Paste a Hugging Face GGUF repo (`owner/repo`, `hf.co/owner/repo` or a
 * huggingface.co URL), list its quants with size and a VRAM-fit hint, and
 * start a download with the chosen quant's ready-to-pull `hf.co/...` tag.
 * Progress then shows in ModelDownloadsPanel like any other download.
 */
export function HfModelPicker() {
  const t = useT();
  const inputId = useId();
  const [value, setValue] = useState("");
  const [repo, setRepo] = useState<HfRepoRef | null>(null);
  const [invalid, setInvalid] = useState(false);
  const quants = useHfQuantsQuery(repo);
  const start = useStartModelDownload();

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const normalized = normalizeHfRepo(value);
    setInvalid(normalized === null);
    setRepo(normalized);
    start.reset();
  }

  const result = quants.data;

  return (
    <section className="flex flex-col gap-2">
      <span className="text-[11px] font-semibold uppercase tracking-[0.09em] text-dim">{t("models.hf.eyebrow")}</span>
      <form className="flex items-end gap-2" onSubmit={handleSubmit}>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <label htmlFor={inputId} className="text-xs text-muted-foreground">
            {t("models.hf.label")}
          </label>
          <Input
            id={inputId}
            className="mono h-9 text-xs"
            placeholder={t("models.hf.placeholder")}
            value={value}
            onChange={(event) => setValue(event.target.value)}
          />
        </div>
        <Button type="submit" variant="outline" className="h-9 px-3 text-xs" disabled={!value.trim() || quants.isFetching}>
          {quants.isFetching && (
            <Loader2 size={12} className="animate-spin motion-reduce:animate-none" aria-hidden="true" />
          )}
          {quants.isFetching ? t("models.hf.loading") : t("models.hf.lookup")}
        </Button>
      </form>

      {invalid && <p className="text-xs text-warn">{t("models.hf.invalidInput")}</p>}

      {quants.isError && (
        <p role="alert" className="text-xs text-danger">
          {hfErrorMessage(quants.error, t)}
        </p>
      )}

      {start.error && (
        <p role="alert" className="text-xs text-danger">
          {requestErrorMessage(start.error, t)}
        </p>
      )}

      {result && (
        <div className="flex flex-col gap-1.5">
          {result.vram_mb !== null && (
            <p className="text-[11px] text-muted-foreground">
              {t("models.hf.vram", { vram: formatBytes(result.vram_mb * 1024 * 1024) })}
            </p>
          )}
          {result.quants.length === 0 ? (
            <p className="text-xs text-muted-foreground">{t("models.hf.noQuants")}</p>
          ) : (
            <ul aria-label={t("models.hf.quantLabel")} className="flex flex-col gap-1.5">
              {result.quants.map((quant) => (
                <li
                  key={quant.tag}
                  className="flex items-center justify-between gap-2 rounded-md border border-border-soft bg-surface-2 px-2.5 py-2 text-xs"
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="mono font-semibold text-foreground">{quant.quant}</span>
                    <span className="mono text-muted-foreground">{formatBytes(quant.size_bytes)}</span>
                    <Badge tone={FIT_TONES[quant.vram_fit]}>{t(FIT_KEYS[quant.vram_fit])}</Badge>
                  </span>
                  <Button
                    variant="outline"
                    className="h-7 shrink-0 px-2.5 text-xs"
                    disabled={start.isPending}
                    aria-label={t("models.hf.download", { quant: quant.quant })}
                    onClick={() => start.mutate(quant.tag)}
                  >
                    {start.isPending && start.variables === quant.tag && (
                      <Loader2 size={12} className="animate-spin motion-reduce:animate-none" aria-hidden="true" />
                    )}
                    {start.isPending && start.variables === quant.tag
                      ? t("models.download.starting")
                      : t("models.download.button")}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
