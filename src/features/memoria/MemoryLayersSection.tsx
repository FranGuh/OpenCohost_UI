import { Switch } from "../../ui/Switch.js";
import { useMemoriaSettingsMutation, useMemoriaSettingsQuery } from "../../api/memoria.js";
import type { MemoriaSettingsRequest } from "../../api/memoria.js";
import { useT, type TKey } from "../../i18n/t.js";

type Layer = keyof MemoriaSettingsRequest;

const LAYERS: ReadonlyArray<{ key: Layer; label: TKey; hint: TKey }> = [
  { key: "facts", label: "controles.memory.layers.facts.label", hint: "controles.memory.layers.facts.hint" },
  { key: "episodes", label: "controles.memory.layers.episodes.label", hint: "controles.memory.layers.episodes.hint" },
  { key: "semantic", label: "controles.memory.layers.semantic.label", hint: "controles.memory.layers.semantic.hint" }
];

/**
 * Per-layer memory controls (memory-semantic-recall T4), wired to
 * GET/POST /api/memoria/settings. Each switch POSTs only its own layer and
 * renders the server's answer — never an optimistic flip — so a failed save
 * (503: not persisted, runtime unchanged) keeps showing the real state.
 *
 * Episodes depend on semantic search (v5 episodic recall is embedding-only),
 * so with semantic off the episodes switch keeps the user's stored choice but
 * is disabled with an explanation. With the master MEMORIAS_ENABLED switch
 * off, no layer reaches the prompt, so every switch is disabled.
 */
export function MemoryLayersSection() {
  const t = useT();
  const { data, isError } = useMemoriaSettingsQuery();
  const mutation = useMemoriaSettingsMutation();

  return (
    <section aria-labelledby="memory-layers-label" className="space-y-2">
      <span id="memory-layers-label" className="text-[11px] font-semibold uppercase tracking-[0.09em] text-dim">
        {t("controles.memory.layers.eyebrow")}
      </span>
      {isError && (
        <p role="alert" className="text-xs leading-relaxed text-danger">
          {t("controles.memory.layers.loadError")}
        </p>
      )}
      {data && (
        <>
          {!data.memorias_enabled && (
            <p className="text-xs leading-relaxed text-warn">{t("controles.memory.layers.masterOff")}</p>
          )}
          <ul className="flex flex-col gap-2">
            {LAYERS.map(({ key, label, hint }) => {
              const needsSemantic = key === "episodes" && !data.semantic;
              return (
                <li
                  key={key}
                  className="grid grid-cols-[1fr_auto] items-center gap-3 rounded-md border border-border-soft bg-surface-2 px-3 py-2"
                >
                  <div className="flex flex-col gap-0.5">
                    <span className="text-sm font-semibold text-foreground">{t(label)}</span>
                    <span className="text-[11px] leading-snug text-dim">{t(hint)}</span>
                    {needsSemantic && (
                      <span className="text-[11px] leading-snug text-warn">
                        {t("controles.memory.layers.episodes.needsSemantic")}
                      </span>
                    )}
                  </div>
                  <Switch
                    checked={data[key]}
                    onChange={(checked) => mutation.mutate({ [key]: checked })}
                    aria-label={t(label)}
                    disabled={!data.memorias_enabled || needsSemantic || mutation.isPending}
                  />
                </li>
              );
            })}
          </ul>
          {mutation.isError && (
            <p role="alert" className="text-xs leading-relaxed text-danger">
              {t("controles.memory.layers.saveError")}
            </p>
          )}
        </>
      )}
    </section>
  );
}
