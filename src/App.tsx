import { StatusRail } from "./components/StatusRail.js";
import { ProfileSwitcher } from "./components/ProfileSwitcher.js";
import { ModelCard } from "./components/ModelCard.js";
import { VoiceCard } from "./components/VoiceCard.js";
import { PTTCard } from "./components/PTTCard.js";
import { MemoryCard } from "./components/MemoryCard.js";
import { ThemeSwitcher } from "./theme/ThemeSwitcher.js";
import { Card } from "./components/ui/Card.js";

/** Slice B2 placeholder — wired in a later slice. */
function PlaceholderCard({ title, note }: { title: string; note: string }) {
  return (
    <Card className="p-4">
      <h2 className="text-sm font-bold text-foreground">{title}</h2>
      <p className="mt-2 text-xs text-muted-foreground">{note}</p>
    </Card>
  );
}

export function App() {
  return (
    <main className="app-shell min-h-screen min-w-[1280px] p-3.5 text-foreground">
      <div className="mb-3.5 flex flex-wrap items-center gap-3.5 border-b border-border-soft pb-3.5">
        <ThemeSwitcher />
        <p className="text-xs text-muted-foreground">
          Mismo markup y componentes — <b className="font-semibold text-foreground">solo cambian los tokens</b>.
        </p>
      </div>

      <div className="mx-auto grid max-w-[1560px] gap-3.5">
        <StatusRail />

        <div className="grid grid-cols-[minmax(360px,35%)_1fr] items-start gap-3.5">
          <aside className="flex flex-col gap-3.5">
            <PlaceholderCard
              title="Experiencia principal"
              note="Avatar, transcripción de Kira y composer llegan en Slice B2."
            />
          </aside>

          <section className="flex flex-col gap-3.5">
            <ProfileSwitcher />
            <ModelCard />
            <VoiceCard />
            <PTTCard />
            <MemoryCard />
          </section>
        </div>
      </div>
    </main>
  );
}
