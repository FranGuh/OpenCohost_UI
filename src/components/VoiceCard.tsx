import { useEffect, useState } from "react";
import { Card } from "../ui/Card.js";
import { Badge } from "../ui/Badge.js";
import { Segmented } from "../ui/Segmented.js";
import { Select } from "../ui/Select.js";
import { Switch } from "../ui/Switch.js";
import { useTtsConfigQuery } from "../api/tts.js";
import { useEngineCommand } from "../api/engineCommand.js";

// Piper voice registry mirrored from opencohost/config/settings.py::PIPER_VOICES
// — no endpoint exposes this catalog (GET /api/tts/config returns only the
// SELECTED piper_voice key), so the option list is hand-kept in sync here.
// ponytail: keep in sync manually if PIPER_VOICES changes.
const VOICE_OPTIONS = [
  { id: "argentina", label: "🇦🇷 Argentina" },
  { id: "neutral", label: "🌎 Neutral" }
] as const;

// Piper speed presets mirrored from opencohost/ui/tts_speed_control.py::SPEED_PRESETS
// (length_scale — higher is slower). ponytail: keep in sync manually.
const SPEED_OPTIONS = [
  { value: "fast", label: "Rápida" },
  { value: "medium", label: "Media" },
  { value: "calm", label: "Calma" },
  { value: "slow", label: "Lenta" }
] as const;
type SpeedOption = (typeof SPEED_OPTIONS)[number]["value"];
const SPEED_SCALE: Record<SpeedOption, number> = { fast: 1.0, medium: 1.15, calm: 1.3, slow: 1.45 };

function closestSpeedOption(scale: number): SpeedOption {
  return (Object.entries(SPEED_SCALE) as [SpeedOption, number][]).reduce((closest, [option, value]) =>
    Math.abs(value - scale) < Math.abs(SPEED_SCALE[closest] - scale) ? option : closest
  , "fast" as SpeedOption);
}

// Motor TTS values mirrored from opencohost/ui/app_shell.py's switch
// (onvalue="ligero", offvalue="pesado") — "pesado" (heavy) is gated by
// heavy_available (EXPERIMENTAL_HEAVY_TTS_ENABLED).
const ENGINE_OPTIONS = [
  { id: "ligero", label: "Ligero (Edge-TTS)" },
  { id: "pesado", label: "Pesado (Heavy)" }
] as const;

/**
 * Voz de Kira card — idioma, modo local, velocidad, motor TTS, all wired to
 * the real backend (GET /api/tts/config; POST /api/commands set_piper_voice /
 * set_tts_local_only / set_tts_speed / set_motor_tts via useEngineCommand).
 * Each control owns its own useEngineCommand instance so exactly one
 * disables while it applies. Displayed value = optimistic local pick while
 * pending, falling back to server truth once the command converges — same
 * pattern as ModelCard/ProfileSwitcher.
 */
export function VoiceCard() {
  const { data, isError: configError } = useTtsConfigQuery();
  const voiceCommand = useEngineCommand<string>();
  const localOnlyCommand = useEngineCommand<boolean>();
  const speedCommand = useEngineCommand<number>();
  const engineCommand = useEngineCommand<string>();

  const [optimisticVoice, setOptimisticVoice] = useState<string | null>(null);
  const [optimisticLocalOnly, setOptimisticLocalOnly] = useState<boolean | null>(null);
  const [optimisticSpeed, setOptimisticSpeed] = useState<SpeedOption | null>(null);
  const [optimisticEngine, setOptimisticEngine] = useState<string | null>(null);

  useEffect(() => {
    if (!voiceCommand.pending) setOptimisticVoice(null);
  }, [voiceCommand.pending]);
  useEffect(() => {
    if (!localOnlyCommand.pending) setOptimisticLocalOnly(null);
  }, [localOnlyCommand.pending]);
  useEffect(() => {
    if (!speedCommand.pending) setOptimisticSpeed(null);
  }, [speedCommand.pending]);
  useEffect(() => {
    if (!engineCommand.pending) setOptimisticEngine(null);
  }, [engineCommand.pending]);

  const voice = optimisticVoice ?? data?.piper_voice ?? VOICE_OPTIONS[0].id;
  const localOnly = optimisticLocalOnly ?? data?.local_only ?? true;
  const speed = optimisticSpeed ?? (data ? closestSpeedOption(data.speed) : "medium");
  const engine = optimisticEngine ?? data?.engine ?? ENGINE_OPTIONS[0].id;
  const pending = voiceCommand.pending || localOnlyCommand.pending || speedCommand.pending || engineCommand.pending;
  const errorMessage =
    voiceCommand.error?.message ??
    localOnlyCommand.error?.message ??
    speedCommand.error?.message ??
    engineCommand.error?.message;

  function applyVoice(value: string) {
    setOptimisticVoice(value);
    void voiceCommand.run("set_piper_voice", value);
  }

  function applyLocalOnly(value: boolean) {
    setOptimisticLocalOnly(value);
    void localOnlyCommand.run("set_tts_local_only", value);
  }

  function applySpeed(value: SpeedOption) {
    setOptimisticSpeed(value);
    void speedCommand.run("set_tts_speed", SPEED_SCALE[value]);
  }

  function applyEngine(value: string) {
    setOptimisticEngine(value);
    void engineCommand.run("set_motor_tts", value);
  }

  return (
    <Card className="flex flex-col p-4">
      <div className="flex items-center justify-between gap-3 border-b border-border-soft pb-3">
        <h2 className="text-sm font-bold text-foreground">Voz de Kira</h2>
        {pending && <Badge tone="info">aplicando…</Badge>}
      </div>

      <div className="flex flex-col gap-3.5 pt-3.5">
        {(errorMessage || configError) && (
          <p role="alert" className="text-xs leading-relaxed text-danger">
            {errorMessage ?? "No se pudo leer la configuración de voz."}
          </p>
        )}

        <section aria-labelledby="voice-select-label" className="space-y-2">
          <span id="voice-select-label" className="text-[11px] font-semibold uppercase tracking-[0.09em] text-dim">
            Idioma
          </span>
          <Select
            aria-label="Idioma"
            value={voice}
            disabled={voiceCommand.pending}
            options={VOICE_OPTIONS.map((option) => ({ value: option.id, label: option.label }))}
            onChange={applyVoice}
          />
        </section>

        <div className="grid grid-cols-[1fr_auto] items-center gap-3">
          <span className="text-[13px] text-foreground">Solo TTS local (Piper)</span>
          <Switch
            checked={localOnly}
            disabled={localOnlyCommand.pending}
            onChange={(checked) => applyLocalOnly(checked)}
            aria-label="Solo TTS local (Piper)"
          />
        </div>

        <section aria-labelledby="speed-label" className="space-y-1.5 flex items-center space-x-3">
          <span id="speed-label" className="text-[11px] font-semibold uppercase tracking-[0.09em] text-dim">
            Velocidad
          </span>
          <Segmented
            options={SPEED_OPTIONS}
            value={speed}
            className="flex items-center gap-1.5 align-center justify-end"
            disabled={speedCommand.pending}
            onChange={(value) => applySpeed(value)}
            ariaLabel="Velocidad de la voz"
          />
        </section>

        <section aria-labelledby="engine-select-label" className="space-y-2">
          <span id="engine-select-label" className="text-[11px] font-semibold uppercase tracking-[0.09em] text-dim">
            Motor TTS
          </span>
          <Select
            aria-label="Motor TTS"
            value={engine}
            disabled={engineCommand.pending}
            options={ENGINE_OPTIONS.map((option) => ({
              value: option.id,
              label: option.label,
              disabled: option.id === "pesado" && !data?.heavy_available
            }))}
            onChange={applyEngine}
          />
        </section>

        <p className="text-xs leading-relaxed text-muted-foreground">
          {localOnly
            ? "TTS 100% local (Piper) — sin conexión a internet ni datos salientes."
            : "Modo nube desactivado por ahora — Piper local sigue siendo el fallback."}
        </p>
        <p className="text-xs leading-relaxed text-dim">
          Voz de referencia (reference-voice) requiere{" "}
          <span className="mono">EXPERIMENTAL_HEAVY_TTS_ENABLED</span> y hardware compatible — no disponible acá.
        </p>
      </div>
    </Card>
  );
}
