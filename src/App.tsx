import { StatusRail } from "./components/StatusRail.js";
import { ProfileSwitcher } from "./components/ProfileSwitcher.js";
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
            <PlaceholderCard title="Modelo" note="Selector de modelo y tiers LLM manual — Slice B2." />
            <PlaceholderCard title="Voz / TTS" note="Idioma, velocidad y modo local/nube — Slice B2." />
            <PlaceholderCard title="PTT · Push-to-Talk" note="Mapeo de tecla y modo de escucha — Slice B2." />
            <PlaceholderCard title="Memoria" note="Gestión de memoria de Kira — Slice B2." />
          </section>
        </div>
      </div>
    </main>
  );
}
