import { EditorialCardsCard } from "./EditorialCardsCard.js";
import { MemoryCard } from "./MemoryCard.js";
import { PersonalizationCard } from "./PersonalizationCard.js";
import { usePaneSwitcher } from "../../ui/PaneSwitcher.js";
import { SettingsSection } from "../shell/SettingsSection.js";
import { useT } from "../../i18n/t.js";

type MemoriaPane = "memory" | "personalization" | "editorialCards";

const MEMORIA_PANE_KEY = "oc-memoria-pane";

/**
 * Memoria — top-level nav section for the three cards that used to live
 * inside Controles' "Memoria y personalización" ControlGroup
 * (docs/MEMORY_SURFACE_HANDOFF.md). A Segmented control switches between
 * them so exactly ONE pane is mounted at a time: with ~118 memories,
 * stacking all three in page flow forced the operator to scroll past the
 * whole memory list to reach Personalization or Editorial Cards — the
 * original complaint, made worse. The switcher itself now lives in
 * SettingsSection's non-scrolling header slot, so it stays on screen
 * regardless of how far the active pane's body scrolls (a switcher that
 * scrolled away with the content would just reintroduce the same complaint
 * one level down); only the active pane's body scrolls, the same reference
 * pattern Controles/Agenda already use (docs/UI_CONSTRAINTS_LEARNED.md §6).
 *
 * i18n keys on the cards keep their historical "controles.memory.*" /
 * "controles.personalization.*" / "controles.editorialCards.*" prefixes —
 * renaming ~120 keys across two typed bundles buys nothing and risks a
 * silent miss. Only the segment labels are new keys, under
 * "controles.memoria.segment.*".
 */
export function MemoriaPanel() {
  const t = useT();
  const options = [
    { value: "memory" as const, label: t("controles.memoria.segment.memory") },
    { value: "personalization" as const, label: t("controles.memoria.segment.personalization") },
    { value: "editorialCards" as const, label: t("controles.memoria.segment.editorialCards") }
  ];
  const { value: pane, switcher } = usePaneSwitcher<MemoriaPane>(options, MEMORIA_PANE_KEY, t("controles.memoria.segment.aria"));

  return (
    <SettingsSection header={switcher}>
      {pane === "memory" && <MemoryCard />}
      {pane === "personalization" && <PersonalizationCard />}
      {pane === "editorialCards" && <EditorialCardsCard />}
    </SettingsSection>
  );
}
