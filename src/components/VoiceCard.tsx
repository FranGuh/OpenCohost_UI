import { useState } from "react";
import { Card } from "./ui/Card.js";
import { Badge } from "./ui/Badge.js";
import { Segmented } from "./ui/Segmented.js";
import { Select } from "./ui/Select.js";
import { Switch } from "./ui/Switch.js";
import { useMockCommand } from "../api/mock/useMockCommand.js";
import { TTS_CONFIG } from "../api/mock/fixtures.js";

// P2: wire to backend TTS config — no /api/tts endpoint exists yet. Speed
// presets stay local (control-only enum, not backend data).
const SPEED_OPTIONS = [
  { value: "fast", label: "Rápida" },
  { value: "medium", label: "Media" },
  { value: "calm", label: "Calma" },
  { value: "slow", label: "Lenta" }
] as const;
type SpeedOption = (typeof SPEED_OPTIONS)[number]["value"];

type VoiceId = (typeof TTS_CONFIG.voices)[number]["id"];
type EngineId = (typeof TTS_CONFIG.engines)[number]["id"];

/**
 * Voz de Kira card — idioma, modo local, velocidad, motor TTS. Each control
 * owns its own useMockCommand instance (accepted != applied, local only — no
 * /api/tts endpoint yet) so exactly one control disables while it "applies",
 * mirroring four independent real per-endpoint mutations. Local state
 * updates immediately; the command only drives the pending/disable/Badge
 * affordance. A persistent role="status" note discloses that none of it
 * persists yet.
 *
 * Heavy-TTS / reference-voice is EXPERIMENTAL_HEAVY_TTS_ENABLED-gated and
 * hardware-bound — out of scope here, one note only, no toggle.
 */
export function VoiceCard() {
  const [voice, setVoice] = useState<VoiceId>(TTS_CONFIG.voices[0].id);
  const [localOnly, setLocalOnly] = useState(true);
  const [speed, setSpeed] = useState<SpeedOption>("medium");
  const [engine, setEngine] = useState<EngineId>(TTS_CONFIG.engines[0].id);
  const voiceCommand = useMockCommand<VoiceId>();
  const localOnlyCommand = useMockCommand<boolean>();
  const speedCommand = useMockCommand<SpeedOption>();
  const engineCommand = useMockCommand<EngineId>();
  const pending = voiceCommand.pending || localOnlyCommand.pending || speedCommand.pending || engineCommand.pending;

  function applyVoice(value: VoiceId) {
    setVoice(value);
    void voiceCommand.run(value);
  }

  function applyLocalOnly(value: boolean) {
    setLocalOnly(value);
    void localOnlyCommand.run(value);
  }

  function applySpeed(value: SpeedOption) {
    setSpeed(value);
    void speedCommand.run(value);
  }

  function applyEngine(value: EngineId) {
    setEngine(value);
    void engineCommand.run(value);
  }

  return (
    <Card className="flex flex-col p-4">
      <div className="flex items-center justify-between gap-3 border-b border-border-soft pb-3">
        <h2 className="text-sm font-bold text-foreground">Voz de Kira</h2>
        {pending && <Badge tone="info">aplicando…</Badge>}
      </div>

      <div className="flex flex-col gap-3.5 pt-3.5">
        <p role="status" className="text-xs leading-relaxed text-muted-foreground">
          Estos cambios no se guardan todavía — no existe endpoint <span className="mono">/api/tts</span> en el
          backend.
        </p>

        <section aria-labelledby="voice-select-label" className="space-y-2">
          <span id="voice-select-label" className="text-[11px] font-semibold uppercase tracking-[0.09em] text-dim">
            Idioma
          </span>
          <Select
            aria-label="Idioma"
            value={voice}
            disabled={voiceCommand.pending}
            onChange={(event) => applyVoice(event.target.value as VoiceId)}
          >
            {TTS_CONFIG.voices.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </Select>
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

        <section aria-labelledby="speed-label" className="space-y-2">
          <span id="speed-label" className="text-[11px] font-semibold uppercase tracking-[0.09em] text-dim">
            Velocidad
          </span>
          <Segmented
            options={SPEED_OPTIONS}
            value={speed}
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
            onChange={(event) => applyEngine(event.target.value as EngineId)}
          >
            {TTS_CONFIG.engines.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </Select>
        </section>

        <p className="text-xs leading-relaxed text-muted-foreground">
          {localOnly
            ? "TTS 100% local (Piper) — sin conexión a internet ni datos salientes."
            : "Modo nube desactivado por ahora — Piper local sigue siendo el fallback."}
        </p>
        <p className="text-xs leading-relaxed text-dim">
          Voz de referencia y motores TTS pesados (Heavy-TTS) requieren{" "}
          <span className="mono">EXPERIMENTAL_HEAVY_TTS_ENABLED</span> y hardware compatible — no disponibles acá.
        </p>
      </div>
    </Card>
  );
}
