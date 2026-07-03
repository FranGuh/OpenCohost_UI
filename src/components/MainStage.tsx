import { useState } from "react";
import { KiraCover } from "./KiraCover.js";
import { Segmented } from "./ui/Segmented.js";
import { ProfileSwitcher } from "./ProfileSwitcher.js";
import { ModelCard } from "./ModelCard.js";
import { VoiceCard } from "./VoiceCard.js";
import { PTTCard } from "./PTTCard.js";
import { MemoryCard } from "./MemoryCard.js";
import { AvatarCard } from "./AvatarCard.js";
import { ObsCard } from "./ObsCard.js";
import { AgendaPanel } from "./AgendaPanel.js";
import { StreamPanel } from "./StreamPanel.js";
import { MusicPanel } from "./MusicPanel.js";
import { DEFAULT_TRANSCRIPT } from "./kiraState.js";
import type { Section } from "./Sidebar.js";

const INPUT_MODES = [
  { value: "chat", label: "Chat" },
  { value: "voz", label: "Voz" }
] as const;

type InputMode = (typeof INPUT_MODES)[number]["value"];

export interface MainStageProps {
  activeSection: Section;
}

/** <main> region — Kira's now-playing stage (Experiencia) or the existing
 * Model/Voice/PTT/Memory settings cards (Controles). */
export function MainStage({ activeSection }: MainStageProps) {
  const [inputMode, setInputMode] = useState<InputMode>("chat");

  if (activeSection === "controles") {
    return (
      <main
        className="flex min-h-0 flex-col gap-3.5 overflow-auto p-4"
        style={{ backgroundImage: "radial-gradient(60% 40% at 50% 0%, var(--accent-soft), transparent 70%)" }}
      >
        <ProfileSwitcher />
        <ModelCard />
        <VoiceCard />
        <PTTCard />
        <MemoryCard />
        <AvatarCard />
        <ObsCard />
      </main>
    );
  }

  if (activeSection === "agenda") {
    return (
      <main
        className="flex min-h-0 flex-col gap-3.5 overflow-auto p-4"
        style={{ backgroundImage: "radial-gradient(60% 40% at 50% 0%, var(--accent-soft), transparent 70%)" }}
      >
        <AgendaPanel />
      </main>
    );
  }

  if (activeSection === "stream") {
    return (
      <main
        className="flex min-h-0 flex-col gap-3.5 overflow-auto p-4"
        style={{ backgroundImage: "radial-gradient(60% 40% at 50% 0%, var(--accent-soft), transparent 70%)" }}
      >
        <StreamPanel />
      </main>
    );
  }

  if (activeSection === "musica") {
    return (
      <main
        className="flex min-h-0 flex-col gap-3.5 overflow-auto p-4"
        style={{ backgroundImage: "radial-gradient(60% 40% at 50% 0%, var(--accent-soft), transparent 70%)" }}
      >
        <MusicPanel />
      </main>
    );
  }

  return (
    <main
      className="flex min-h-0 flex-col items-center justify-center gap-4 overflow-auto p-6"
      style={{ backgroundImage: "radial-gradient(60% 40% at 50% 0%, var(--accent-soft), transparent 70%)" }}
    >
      <Segmented ariaLabel="Modo de entrada" options={INPUT_MODES} value={inputMode} onChange={setInputMode} />

      <KiraCover />

      <div className="flex flex-col items-center gap-1 text-center">
        <h1 className="text-2xl font-extrabold tracking-tight text-foreground">Kira</h1>
        <p className="text-xs text-muted-foreground">Akira · co-host local · Qwen 3 (1.7B)</p>
      </div>

      <p className="max-w-[520px] rounded-md border border-border bg-background px-4 py-3 text-center text-sm leading-relaxed text-foreground">
        <span className="font-bold text-[var(--kira-cyan)]">[Kira] </span>
        {DEFAULT_TRANSCRIPT}
      </p>
    </main>
  );
}
