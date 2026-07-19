import { useEffect, useState } from "react";
import { Card } from "./ui/Card.js";
import { Badge } from "./ui/Badge.js";
import { Button } from "./ui/Button.js";
import { Input } from "./ui/Input.js";
import { Switch } from "./ui/Switch.js";
import { ConfirmFooter } from "./ui/ConfirmFooter.js";
import { SubCollapsibleSection } from "./ui/Collapsible.js";
import {
  PERSONALIZATION_INSTRUCTIONS_MAX,
  PERSONALIZATION_INTERESTS_MAX,
  PERSONALIZATION_NICKNAME_MAX,
  PERSONALIZATION_OCCUPATION_MAX,
  useClearPersonalizationMutation,
  usePersonalizationQuery,
  useUpdatePersonalizationMutation
} from "../api/personalization.js";

type PersonalizationForm = {
  enabled: boolean;
  nickname: string;
  occupation: string;
  interests: string;
  custom_instructions: string;
};

const EMPTY_FORM: PersonalizationForm = {
  enabled: true,
  nickname: "",
  occupation: "",
  interests: "",
  custom_instructions: ""
};

// Kept byte-identical to ProfileEditor's SAVE_BUTTON_CLASS so the two save
// buttons stay uniform (calm flat bg-primary, matching the WelcomeCard family).
const SAVE_BUTTON_CLASS =
  "inline-flex items-center justify-center rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground transition-[filter] duration-fast ease-io hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:opacity-60";

/**
 * Personalization card — sibling settings card to MemoryCard, wired to
 * GET/PUT/DELETE /api/personalization (opencohost/api/main.py ~851-915).
 * Global (profile-independent) streamer identity store — see design.md §1.
 *
 * Save PUTs the whole form (server treats every field as an optional
 * partial update, but sending the full form is simplest and always
 * correct). "Limpiar" is destructive and irreversible, so it keeps the
 * same two-step confirm as MemoryCard's "Limpiar memoria" / ProfileEditor's
 * delete-profile confirm — no confirm dialog component, just a local
 * confirm/cancel row.
 */
export function PersonalizationCard() {
  const { data, isError: getError } = usePersonalizationQuery();
  const updateMutation = useUpdatePersonalizationMutation();
  const clearMutation = useClearPersonalizationMutation();
  const [form, setForm] = useState<PersonalizationForm>(EMPTY_FORM);
  const [confirmingClear, setConfirmingClear] = useState(false);

  // Seed the form once GET resolves (and again after a save/clear
  // invalidation reloads it) — never clobbers in-progress typing since
  // `data` only changes on a real fetch, not on every render.
  useEffect(() => {
    if (!data) return;
    setForm({
      enabled: data.enabled,
      nickname: data.nickname,
      occupation: data.occupation,
      interests: data.interests,
      custom_instructions: data.custom_instructions
    });
  }, [data]);

  function handleConfirmClear() {
    setConfirmingClear(false);
    clearMutation.mutate();
  }

  return (
    <Card className="flex flex-col p-4">
      <div className="flex items-center justify-between gap-3 border-b border-border-soft pb-3">
        <h2 className="text-sm font-bold text-foreground">Personalización</h2>
        {updateMutation.isPending && <Badge tone="info">guardando…</Badge>}
      </div>

      <div className="flex flex-col gap-3.5 pt-3.5">
        {getError && (
          <p role="alert" className="text-xs leading-relaxed text-danger">
            No se pudo leer la personalización.
          </p>
        )}
        {updateMutation.isError && (
          <p role="alert" className="text-xs leading-relaxed text-danger">
            {updateMutation.error?.message ?? "No se pudo guardar la personalización."}
          </p>
        )}
        {clearMutation.isError && (
          <p role="alert" className="text-xs leading-relaxed text-danger">
            {clearMutation.error?.message ?? "No se pudo borrar la personalización."}
          </p>
        )}

        {data && (
          <>
            <SubCollapsibleSection title="Tus datos" persistKey="personalization-form">
              <div className="flex flex-col gap-3.5">
                <section className="grid grid-cols-[1fr_auto] items-center gap-3">
                  <span className="text-[13px] text-foreground">Habilitar personalización</span>
                  <Switch
                    aria-label="Habilitar personalización"
                    checked={form.enabled}
                    onChange={(checked) => setForm((prev) => ({ ...prev, enabled: checked }))}
                  />
                </section>

                <label className="flex flex-col gap-1 text-[11px] font-semibold text-dim">
                  {`Apodo (máx. ${PERSONALIZATION_NICKNAME_MAX})`}
                  <Input
                    aria-label="Apodo"
                    value={form.nickname}
                    maxLength={PERSONALIZATION_NICKNAME_MAX}
                    onChange={(event) => setForm((prev) => ({ ...prev, nickname: event.target.value }))}
                  />
                </label>

                <label className="flex flex-col gap-1 text-[11px] font-semibold text-dim">
                  {`Ocupación (máx. ${PERSONALIZATION_OCCUPATION_MAX})`}
                  <Input
                    aria-label="Ocupación"
                    value={form.occupation}
                    maxLength={PERSONALIZATION_OCCUPATION_MAX}
                    onChange={(event) => setForm((prev) => ({ ...prev, occupation: event.target.value }))}
                  />
                </label>

                <label className="flex flex-col gap-1 text-[11px] font-semibold text-dim">
                  {`Intereses (máx. ${PERSONALIZATION_INTERESTS_MAX})`}
                  <Input
                    aria-label="Intereses"
                    value={form.interests}
                    maxLength={PERSONALIZATION_INTERESTS_MAX}
                    onChange={(event) => setForm((prev) => ({ ...prev, interests: event.target.value }))}
                  />
                </label>

                <label className="flex flex-col gap-1 text-[11px] font-semibold text-dim">
                  {`Instrucciones personalizadas (máx. ${PERSONALIZATION_INSTRUCTIONS_MAX})`}
                  <textarea
                    aria-label="Instrucciones personalizadas"
                    value={form.custom_instructions}
                    maxLength={PERSONALIZATION_INSTRUCTIONS_MAX}
                    onChange={(event) => setForm((prev) => ({ ...prev, custom_instructions: event.target.value }))}
                    rows={4}
                    className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-dim focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring resize-y overflow-y-auto min-h-[96px] max-h-[240px]"
                  />
                </label>

                <div className="flex items-center justify-end gap-2 border-t border-border-soft pt-3">
                  <button
                    type="button"
                    className={SAVE_BUTTON_CLASS}
                    disabled={updateMutation.isPending}
                    onClick={() => updateMutation.mutate(form)}
                  >
                    {updateMutation.isPending ? "Guardando…" : "Guardar"}
                  </button>
                </div>
              </div>
            </SubCollapsibleSection>

            {/* Destructive group defaults CLOSED — a distinct header title
                ("Borrar datos guardados") avoids colliding with the confirm
                footer's own "Borrar personalización" advance button. */}
            <SubCollapsibleSection title="Borrar datos guardados" persistKey="personalization-clear" defaultOpen={false}>
              {confirmingClear ? (
                <ConfirmFooter
                  active
                  stages={[
                    {
                      message:
                        "Esto borra el apodo, ocupación, intereses e instrucciones guardados. No se puede deshacer.",
                      acknowledgment: "Sí, entiendo",
                      advanceLabel: "Borrar personalización"
                    }
                  ]}
                  onConfirm={handleConfirmClear}
                  onCancel={() => setConfirmingClear(false)}
                  busy={clearMutation.isPending}
                />
              ) : (
                <div className="grid grid-cols-[1fr_auto] items-center gap-3">
                  <p className="text-xs leading-relaxed text-warn">
                    Borra el apodo, ocupación, intereses e instrucciones guardados; no se puede deshacer.
                  </p>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={clearMutation.isPending}
                    onClick={() => setConfirmingClear(true)}
                  >
                    Limpiar
                  </Button>
                </div>
              )}
            </SubCollapsibleSection>
          </>
        )}
      </div>
    </Card>
  );
}
