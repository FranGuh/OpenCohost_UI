import { useT } from "../../i18n/t.js";
import { usePaneSwitcher } from "../../ui/PaneSwitcher.js";
import { SettingsSection } from "../shell/SettingsSection.js";
import { ProfileSwitcher } from "../perfiles/ProfileSwitcher.js";
import { ModelCard } from "./ModelCard.js";
import { ProviderCard } from "./ProviderCard.js";
import { TavilyCard } from "./TavilyCard.js";
import { VoiceCard } from "./VoiceCard.js";
import { PronunciationCard } from "./PronunciationCard.js";
import { GuardrailsCard } from "./GuardrailsCard.js";
import { ReplyLengthCard } from "./ReplyLengthCard.js";
import { DecisionsCard } from "./DecisionsCard.js";
import { SelfKnowledgeCard } from "./SelfKnowledgeCard.js";
import { PTTCard } from "./PTTCard.js";
import { VisionCard } from "./VisionCard.js";
import { AvatarCard } from "./AvatarCard.js";
import { ObsCard } from "./ObsCard.js";
import { LinkPhonePanel } from "../remote/LinkPhonePanel.js";

type ControlesPane = "identity" | "models" | "voice" | "vision" | "phone" | "avatar";

const CONTROLES_PANE_KEY = "oc-controles-pane";

/**
 * Controles panel — settings grouped into six panes so
 * exactly one group is on screen at a time (same PaneSwitcher pattern
 * Memoria introduced). Replaces the former three-accordion layout
 * (ControlGroup + useCollapsible/persistKey, now deleted) — the
 * "oc-collapse-controles-*" localStorage keys it used to write are orphaned;
 * no migration, they just stop being read. The segment labels AND each
 * pane's restored `<h2>` reuse the existing "controles.groups.*.title" keys
 * (they were the accordion headers) instead of adding new copy.
 *
 * All five panes stay MOUNTED — hidden via the `hidden` attribute, not
 * `pane === … &&` conditional rendering. `ControlGroup` (the deleted
 * accordion) never unmounted its children either (Collapsible.tsx keeps
 * collapsed content mounted with inert+aria-hidden), so this is a return to
 * that prior behaviour, not a new risk. It matters here because unmounting
 * silently destroys local component state that never round-trips through the
 * server: ObsCard's `password` is WRITE-ONLY (never re-hydrated),
 * ProviderCard's apiKey/baseUrl/model/customId/editId are typed drafts with
 * no undo, and LinkPhonePanel's minted pairing code lives in mutation state.
 * `hidden` (not the Tailwind `.hidden` class) so the collapse holds
 * even without CSS, and — like Tabs.tsx's TabPanel — an inline
 * `display: none` fallback, because the `flex` utility class on the same
 * element would otherwise outrank the `[hidden]` UA rule in a real browser
 * (jsdom doesn't run the CSS cascade, so a test would stay green either way).
 *
 * Memoria (MemoriaPanel.tsx) is the deliberate exception that still unmounts
 * its inactive panes: with ~118 memory rows each owning three useState, a
 * useMemoriaRowQuery and three mutations, keeping all three panes mounted
 * would mean paying that cost even while the operator is nowhere near the
 * memory list. Do not "harmonise" the two — they optimise for different
 * things (draft safety here, per-row query/mutation cost there).
 */
export function ControlsPanel() {
  const t = useT();
  const options = [
    { value: "identity" as const, label: t("controles.groups.identity.title") },
    { value: "models" as const, label: t("controles.groups.models.title") },
    { value: "voice" as const, label: t("controles.groups.voice.title") },
    { value: "vision" as const, label: t("controles.groups.vision.title") },
    { value: "phone" as const, label: t("controles.groups.phone.title") },
    { value: "avatar" as const, label: t("controles.groups.avatar.title") }
  ];
  const { value: pane, switcher } = usePaneSwitcher<ControlesPane>(options, CONTROLES_PANE_KEY, t("controles.groups.segment.aria"));

  return (
    <SettingsSection header={switcher}>
      <div
        data-testid="controles-pane-identity"
        hidden={pane !== "identity"}
        style={pane !== "identity" ? { display: "none" } : undefined}
        className="flex flex-col gap-3.5"
      >
        <h2 className="text-sm font-bold text-foreground">{t("controles.groups.identity.heading")}</h2>
        <ProfileSwitcher />



        <GuardrailsCard />
        <ReplyLengthCard />
        <DecisionsCard />
        <SelfKnowledgeCard />
      </div>
      <div
        data-testid="controles-pane-models"
        hidden={pane !== "models"}
        style={pane !== "models" ? { display: "none" } : undefined}
        className="flex flex-col gap-3.5"
      >
        <h2 className="text-sm font-bold text-foreground">{t("controles.groups.models.heading")}</h2>
        <ModelCard />
        <ProviderCard />
        <TavilyCard />
      </div>
      <div
        data-testid="controles-pane-voice"
        hidden={pane !== "voice"}
        style={pane !== "voice" ? { display: "none" } : undefined}
        className="flex flex-col gap-3.5"
      >
        <h2 className="text-sm font-bold text-foreground">{t("controles.groups.voice.title")}</h2>
        <VoiceCard />
        <PronunciationCard />
        <PTTCard />
      </div>
      <div
        data-testid="controles-pane-vision"
        hidden={pane !== "vision"}
        style={pane !== "vision" ? { display: "none" } : undefined}
        className="flex flex-col gap-3.5"
      >
        <h2 className="text-sm font-bold text-foreground">{t("controles.groups.vision.heading")}</h2>
        <VisionCard />
      </div>
      <div
        data-testid="controles-pane-phone"
        hidden={pane !== "phone"}
        style={pane !== "phone" ? { display: "none" } : undefined}
        className="flex flex-col gap-3.5"
      >
        <h2 className="text-sm font-bold text-foreground">{t("controles.groups.phone.heading")}</h2>
        <LinkPhonePanel />
      </div>
      <div
        data-testid="controles-pane-avatar"
        hidden={pane !== "avatar"}
        style={pane !== "avatar" ? { display: "none" } : undefined}
        className="flex flex-col gap-3.5"
      >
        <h2 className="text-sm font-bold text-foreground">{t("controles.groups.avatar.title")}</h2>
        <AvatarCard />
        <ObsCard />
      </div>
    </SettingsSection>
  );
}
