import type { ReactNode } from "react";
import { Card } from "../ui/Card.js";
import { CollapsibleHeader, CollapsibleBody, useCollapsible } from "../ui/Collapsible.js";
import { ProfileSwitcher } from "./ProfileSwitcher.js";
import { ModelCard } from "./ModelCard.js";
import { ProviderCard } from "./ProviderCard.js";
import { VoiceCard } from "./VoiceCard.js";
import { PTTCard } from "./PTTCard.js";
import { MemoryCard } from "./MemoryCard.js";
import { EditorialCardsCard } from "./EditorialCardsCard.js";
import { PersonalizationCard } from "./PersonalizationCard.js";
import { AvatarCard } from "./AvatarCard.js";
import { ObsCard } from "./ObsCard.js";

/**
 * Controles panel — the eight settings cards, grouped into collapsible sections
 * so the panel reads as a short accordion instead of one long scroll. Each
 * group uses the SAME ui/Collapsible card idiom as Stream/Agenda (header +
 * chevron + persistKey, default open) and its open/collapsed state survives
 * navigation via localStorage.
 *
 * The grouped cards keep their own Card chrome, so a group is an accordion of
 * sub-cards (a group title distinct from each sub-card's title). This is pure
 * structure — every control keeps its exact behaviour; no handler is rewired.
 */
interface ControlGroupProps {
  title: string;
  persistKey: string;
  children: ReactNode;
}

function ControlGroup({ title, persistKey, children }: ControlGroupProps) {
  const [isOpen, toggle] = useCollapsible(true, persistKey);
  return (
    <Card className="flex flex-col p-4">
      <CollapsibleHeader isOpen={isOpen} onToggle={toggle}>
        <h2 className="text-sm font-bold text-foreground">{title}</h2>
      </CollapsibleHeader>
      <CollapsibleBody isOpen={isOpen}>
        <div className="flex flex-col gap-3.5">{children}</div>
      </CollapsibleBody>
    </Card>
  );
}

export function ControlsPanel() {
  return (
    <>
      <ControlGroup title="Perfil y modelo" persistKey="controles-perfil-modelo">
        <ProfileSwitcher />
        <ModelCard />
        <ProviderCard />
      </ControlGroup>
      <ControlGroup title="Voz y micrófono" persistKey="controles-voz-microfono">
        <VoiceCard />
        <PTTCard />
      </ControlGroup>
      <ControlGroup title="Memoria y personalización" persistKey="controles-memoria-personalizacion">
        <MemoryCard />
        <PersonalizationCard />
        <EditorialCardsCard />
      </ControlGroup>
      <ControlGroup title="Avatar y OBS" persistKey="controles-avatar-obs">
        <AvatarCard />
        <ObsCard />
      </ControlGroup>
    </>
  );
}
