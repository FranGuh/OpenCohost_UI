import { useState } from "react";
import { EditorialCardsCard } from "./EditorialCardsCard.js";
import { MemoryCard } from "./MemoryCard.js";
import { PersonalizationCard } from "./PersonalizationCard.js";
import { Segmented } from "../../ui/Segmented.js";
import { useT } from "../../i18n/t.js";

type MemoriaPane = "memory" | "personalization" | "editorialCards";

const MEMORIA_PANE_KEY = "oc-memoria-pane";

function readMemoriaPane(): MemoriaPane {
  try {
    const stored = window.localStorage.getItem(MEMORIA_PANE_KEY);
    if (stored === "memory" || stored === "personalization" || stored === "editorialCards") return stored;
  } catch {
    // best-effort read; falls through to the default below
  }
  return "memory";
}

/**
 * Memoria — top-level nav section for the three cards that used to live
 * inside Controles' "Memoria y personalización" ControlGroup
 * (docs/MEMORY_SURFACE_HANDOFF.md). A Segmented control switches between
 * them so exactly ONE pane is mounted at a time: with ~118 memories,
 * stacking all three in page flow forced the operator to scroll past the
 * whole memory list to reach Personalization or Editorial Cards — the
 * original complaint, made worse. The active pane still has no inner
 * scroll box of its own: MainStage's `<main overflow-auto>` is the single
 * scroll owner, the same reference pattern Agenda/Stream/Música already use
 * (docs/UI_CONSTRAINTS_LEARNED.md §6).
 *
 * i18n keys on the cards keep their historical "controles.memory.*" /
 * "controles.personalization.*" / "controles.editorialCards.*" prefixes —
 * renaming ~120 keys across two typed bundles buys nothing and risks a
 * silent miss. Only the segment labels are new keys, under
 * "controles.memoria.segment.*".
 */
export function MemoriaPanel() {
  const t = useT();
  const [pane, setPane] = useState<MemoriaPane>(readMemoriaPane);

  function selectPane(next: MemoriaPane) {
    setPane(next);
    try {
      window.localStorage.setItem(MEMORIA_PANE_KEY, next);
    } catch {
      // best-effort persistence; the in-memory selection still holds
    }
  }

  const options = [
    { value: "memory" as const, label: t("controles.memoria.segment.memory") },
    { value: "personalization" as const, label: t("controles.memoria.segment.personalization") },
    { value: "editorialCards" as const, label: t("controles.memoria.segment.editorialCards") }
  ];

  return (
    <>
      <Segmented options={options} value={pane} onChange={selectPane} ariaLabel={t("controles.memoria.segment.aria")} />
      {pane === "memory" && <MemoryCard />}
      {pane === "personalization" && <PersonalizationCard />}
      {pane === "editorialCards" && <EditorialCardsCard />}
    </>
  );
}
