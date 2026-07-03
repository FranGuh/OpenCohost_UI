import { useState } from "react";
import { Card } from "./ui/Card.js";
import { Segmented } from "./ui/Segmented.js";
import { Switch } from "./ui/Switch.js";

// P2: wire to backend TTS config — no endpoint exists yet for voice/idioma,
// local-only toggle, or speed. All local UI state per the spec's P1 scope.
const VOICE_OPTIONS = [
  { value: "ar", label: "AR Argentina" },
  { value: "neutral", label: "Neutral" }
] as const;
type VoiceOption = (typeof VOICE_OPTIONS)[number]["value"];

const SPEED_OPTIONS = [
  { value: "fast", label: "Rápida" },
  { value: "medium", label: "Media" },
  { value: "calm", label: "Calma" },
  { value: "slow", label: "Lenta" }
] as const;
type SpeedOption = (typeof SPEED_OPTIONS)[number]["value"];

/** Voz de Kira card — idioma, modo local, velocidad. Design system treatment. */
export function VoiceCard() {
  const [voice, setVoice] = useState<VoiceOption>("ar");
  const [localOnly, setLocalOnly] = useState(true);
  const [speed, setSpeed] = useState<SpeedOption>("medium");

  return (
    <Card className="flex flex-col gap-3 p-4">
      <h2 className="text-sm font-bold text-foreground">Voz de Kira</h2>

      <div className="grid gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-[0.09em] text-dim">Idioma</span>
        <Segmented options={VOICE_OPTIONS} value={voice} onChange={setVoice} ariaLabel="Idioma de la voz" />
      </div>

      <div className="flex items-center justify-between gap-3">
        <span className="text-[13px] text-foreground">Solo TTS local (Piper)</span>
        <Switch checked={localOnly} onChange={setLocalOnly} aria-label="Solo TTS local (Piper)" />
      </div>

      <div className="grid gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-[0.09em] text-dim">Velocidad</span>
        <Segmented options={SPEED_OPTIONS} value={speed} onChange={setSpeed} ariaLabel="Velocidad de la voz" />
      </div>

      <p className="text-xs leading-relaxed text-muted-foreground">
        {localOnly
          ? "TTS 100% local (Piper) — sin conexión a internet ni datos salientes."
          : "Modo nube desactivado por ahora — Piper local sigue siendo el fallback."}
      </p>
    </Card>
  );
}
