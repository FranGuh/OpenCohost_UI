import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { FormEvent, ReactNode } from "react";
import {
  AlignLeft,
  Cpu,
  Flame,
  History,
  Sparkles,
  Trash2,
  UserRound,
  Users,
  X
} from "lucide-react";
import { Card } from "../../ui/Card.js";
import { Button } from "../../ui/Button.js";
import { Alert } from "../../ui/Alert.js";
import { ConfirmFooter, ConfirmToggle } from "../../ui/ConfirmFooter.js";
import { Dialog } from "../../ui/Dialog.js";
import { Select } from "../../ui/Select.js";
import { Switch } from "../../ui/Switch.js";
import {
  primaryLocale,
  type ProfileCreateRequest,
  type ProfileUpdateRequest,
  useCreateProfileMutation,
  useDeleteProfileMutation,
  useSwitchProfileMutation,
  PROFILE_OWNER_GENDERS,
  PROFILE_WARMTHS,
  type ProfileOwnerGender,
  type ProfileWarmth,
  useProfileDetailQuery,
  useUpdateProfileMutation
} from "../../api/profiles.js";
import { getI18nState } from "../../api/i18n.js";
import { STATUS_QUERY_KEY } from "../../api/status.js";
import type { StatusResponse } from "../../api/client.js";
import { useMemoriaPurgeMutation } from "../../api/memoria.js";
import { useUiLocale } from "../../i18n/locale.js";
import { useT, type TKey } from "../../i18n/t.js";

export type ProfileEditorMode = "create" | "edit";

export interface ProfileEditorProps {
  open: boolean;
  mode: ProfileEditorMode;
  onClose: () => void;
  /** Edit mode only — name of the profile being edited (prefilled). */
  initialName?: string;
}

const TITLE_KEYS: Record<ProfileEditorMode, TKey> = {
  create: "perfiles.editor.title.create",
  edit: "perfiles.editor.title.edit"
};

// Calm primary-button family (matches the WelcomeCard primary buttons —
// flat bg-primary, not the accent gradient). Kept byte-identical in
// PersonalizationCard so the two save buttons stay uniform.
const SAVE_BUTTON_CLASS =
  "inline-flex items-center justify-center rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground transition-[filter] duration-fast ease-io hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:opacity-60";

const FIELD_LABEL_CLASS = "text-[11px] font-semibold uppercase tracking-[0.09em] text-dim";

/** Subtle bordered panel that groups one field (or a few related ones). */
const PANEL_CLASS = "space-y-3 rounded-lg border border-border-soft bg-surface-2/40 p-3";

/** Field label with a small leading icon (decorative). */
function IconLabel({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <span className="flex items-center gap-1.5">
      <span aria-hidden="true" className="text-muted-foreground">
        {icon}
      </span>
      {children}
    </span>
  );
}

/**
 * Profile create / rename / edit-system-prompt / delete(+memoria-purge)
 * dialog — parity target: opencohost/ui/profiles_window.py. Wired to the
 * real CRUD routes (opencohost/api/main.py ~606-702): POST/PUT/GET/DELETE
 * /api/perfiles(/{name}). Edit mode hydrates the prompt from GET so a save
 * always resends a real value (never the old "empty means unchanged" mock
 * convention). `use_system` controls whether instructions travel via the
 * official 'system' role or inside the user message.
 */
/** Fallback max_turns bound when the API reports no engine cap. */
const DEFAULT_MAX_TURNS_CAP = 10;

export function ProfileEditor({ open, mode, onClose, initialName = "" }: ProfileEditorProps) {
  const t = useT();
  const { locale: uiLocale } = useUiLocale();
  const [name, setName] = useState(initialName);
  const [systemPrompt, setSystemPrompt] = useState("");
  const [extendedResponses, setExtendedResponses] = useState(false);
  const [warmth, setWarmth] = useState<ProfileWarmth>("cold");
  const [ownerGender, setOwnerGender] = useState<ProfileOwnerGender>("");
  const warmthIndex = PROFILE_WARMTHS.indexOf(warmth);
  const warmthPct = (warmthIndex / (PROFILE_WARMTHS.length - 1)) * 100;
  const [useSystem, setUseSystem] = useState(false);
  const [maxTurns, setMaxTurns] = useState(3);
  const [nameTouched, setNameTouched] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [purgeMemory, setPurgeMemory] = useState(true);
  const [resolvingLocale, setResolvingLocale] = useState(false);
  // Set only once the profile itself has already been deleted successfully
  // but the follow-up memoria purge failed — the profile no longer exists,
  // so retrying must re-attempt ONLY the purge, never the delete.
  const [purgeFailedAfterDelete, setPurgeFailedAfterDelete] = useState(false);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const initialNameRef = useRef(initialName);
  initialNameRef.current = initialName;

  // Match useProfileSwitch.tsx: profiles belong to the backend active locale
  // (falling back to uiLocale if GET /api/i18n is unavailable). Share the
  // ["i18n"] cache populated by ProfileSwitchProvider when mounted inside the app.
  const i18nQuery = useQuery({
    queryKey: ["i18n"],
    queryFn: getI18nState,
    staleTime: 60_000,
    enabled: open && mode === "create"
  });
  // Hydration query — only fetches while the dialog is open in edit mode, so
  // the always-mounted component never fetches in the background while
  // closed or while creating a new profile.
  const profileDetail = useProfileDetailQuery(open && mode === "edit" ? initialName : null);
  const createMutation = useCreateProfileMutation();
  const updateMutation = useUpdateProfileMutation();
  const switchMutation = useSwitchProfileMutation();
  const queryClient = useQueryClient();
  const deleteMutation = useDeleteProfileMutation();
  // Memoria rows are stored keyed by the profile's stable uuid, not its
  // display name — target the `id` hydrated from GET /api/perfiles/{name},
  // never `initialName`.
  const purgeMutation = useMemoriaPurgeMutation(profileDetail.data?.id ?? "");
  // Engine history cap derived from the active model's context window. Only
  // the edit-mode GET carries it; create mode (or an older backend) keeps the
  // historical bound of 10. The engine clamps again on apply.
  const maxTurnsCap = profileDetail.data?.max_turns_cap ?? DEFAULT_MAX_TURNS_CAP;

  // On open: reset from the open-time initialName (a later activeProfile
  // reconcile must not clobber in-progress input). Trigger capture, initial
  // focus, and focus restoration on close are Dialog's job now.
  useEffect(() => {
    if (!open) return;
    setName(initialNameRef.current);
    setSystemPrompt("");
    setExtendedResponses(false);
    setWarmth("cold");
    setOwnerGender("");
    setUseSystem(false);
    setMaxTurns(3);
    setNameTouched(false);
    setDeleting(false);
    setPurgeMemory(true);
    setResolvingLocale(false);
    setPurgeFailedAfterDelete(false);
    createMutation.reset();
    updateMutation.reset();
    deleteMutation.reset();
    purgeMutation.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Hydrate the prompt from the real backend once GET /api/perfiles/{name}
  // resolves. Declared AFTER the reset effect above so, on the same open
  // transition, this effect's write wins even when profileDetail.data was
  // already cached from a previous open of the same profile (in which case
  // its reference — and thus this effect's own dependency — never changes).
  useEffect(() => {
    if (!open || mode !== "edit" || !profileDetail.data) return;
    setSystemPrompt(profileDetail.data.prompt);
    setExtendedResponses(Boolean(profileDetail.data.extended_responses));
    setWarmth(profileDetail.data.warmth ?? "cold");
    setOwnerGender(profileDetail.data.owner_gender ?? "");
    setUseSystem(Boolean(profileDetail.data.use_system));
    setMaxTurns(profileDetail.data.max_turns ?? 3);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, mode, profileDetail.data]);

  const trimmedName = name.trim();
  const nameInvalid = nameTouched && trimmedName.length === 0;
  const savePending = mode === "create" ? resolvingLocale || createMutation.isPending : updateMutation.isPending;
  const saveError = mode === "create" ? createMutation.error : updateMutation.error;

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setNameTouched(true);
    if (!trimmedName) return;

    if (mode === "create") {
      let rawLocale = i18nQuery.data?.active_locale;
      if (!rawLocale && i18nQuery.isPending) {
        setResolvingLocale(true);
        try {
          const i18n = await queryClient.ensureQueryData({
            queryKey: ["i18n"],
            queryFn: getI18nState,
            staleTime: 60_000
          });
          rawLocale = i18n.active_locale;
        } catch {
          // Fall back to uiLocale below when GET /api/i18n fails.
        } finally {
          setResolvingLocale(false);
        }
      }
      const createLocale = primaryLocale((rawLocale ?? "").trim() || uiLocale) || uiLocale;
      const createBody: ProfileCreateRequest = {
        name: trimmedName,
        prompt: systemPrompt,
        locale: createLocale
      };
      if (extendedResponses) createBody.extended_responses = true;
      if (warmth !== "cold") createBody.warmth = warmth;
      if (ownerGender !== "") createBody.owner_gender = ownerGender;
      if (useSystem) createBody.use_system = true;
      if (maxTurns !== 3) createBody.max_turns = maxTurns;
      createMutation.mutate(createBody, { onSuccess: onClose });
      return;
    }

    const body: ProfileUpdateRequest = { prompt: systemPrompt };
    if (trimmedName !== initialName) body.new_name = trimmedName;
    if (extendedResponses !== Boolean(profileDetail.data?.extended_responses)) {
      body.extended_responses = extendedResponses;
    }
    if (warmth !== (profileDetail.data?.warmth ?? "cold")) {
      body.warmth = warmth;
    }
    if (ownerGender !== (profileDetail.data?.owner_gender ?? "")) {
      body.owner_gender = ownerGender;
    }
    if (useSystem !== Boolean(profileDetail.data?.use_system)) {
      body.use_system = useSystem;
    }
    if (maxTurns !== (profileDetail.data?.max_turns ?? 3)) {
      body.max_turns = maxTurns;
    }
    // The engine reads warmth/extended_responses only on profile switch or
    // boot, so saving the ACTIVE profile re-triggers the switch (to the new
    // name when renamed) for the change to take effect immediately.
    const activeProfile = queryClient.getQueryData<StatusResponse>(STATUS_QUERY_KEY)?.active_profile;
    updateMutation.mutate(
      { name: initialName, body },
      {
        onSuccess: () => {
          if (activeProfile && activeProfile === initialName) {
            switchMutation.mutate({ name: body.new_name ?? initialName });
          }
          onClose();
        }
      }
    );
  }

  // Delete and purge run SEQUENTIALLY — the dialog only closes once both
  // steps that were requested actually succeed. If the purge fails after a
  // successful delete, the profile is already gone: keep the dialog open
  // and surface the failure instead of silently losing it (fire-and-forget
  // was the bug — a lost purge left orphaned memoria rows with no
  // indication anything went wrong).
  function handleConfirmDelete() {
    deleteMutation.mutate(initialName, {
      onSuccess: () => {
        if (!purgeMemory) {
          onClose();
          return;
        }
        purgeMutation.mutate(undefined, {
          onSuccess: onClose,
          onError: () => setPurgeFailedAfterDelete(true)
        });
      }
    });
  }

  function handleRetryPurge() {
    purgeMutation.mutate(undefined, {
      onSuccess: onClose,
      onError: () => setPurgeFailedAfterDelete(true)
    });
  }

  return (
    <Dialog open={open} onClose={onClose} ariaLabelledBy="profile-editor-title" initialFocusRef={nameInputRef}>
      <Card className="flex min-h-0 w-full flex-col overflow-y-auto p-4">
        <div className="flex items-center justify-between gap-3 border-b border-border-soft pb-3">
          <h2 id="profile-editor-title" className="text-sm font-bold text-foreground">
            {t(TITLE_KEYS[mode])}
          </h2>
          <button
            type="button"
            aria-label={t("perfiles.editor.close.aria")}
            onClick={onClose}
            className="flex h-7 w-7 items-center justify-center rounded-full text-muted-foreground transition-colors duration-fast ease-io hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            <X aria-hidden="true" size={16} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-3 pt-3.5">
          <div className={PANEL_CLASS}>
            <div className="space-y-2">
              <label htmlFor="profile-editor-name" className={FIELD_LABEL_CLASS}>
                <IconLabel icon={<UserRound size={14} />}>{t("perfiles.editor.name.label")}</IconLabel>
              </label>
              <input
                id="profile-editor-name"
                ref={nameInputRef}
                type="text"
                value={name}
                onChange={(event) => setName(event.target.value)}
                onBlur={() => setNameTouched(true)}
                placeholder={t("perfiles.editor.name.placeholder")}
                className="h-11 w-full rounded-md border border-border bg-background px-3 text-sm font-semibold text-foreground placeholder:text-dim focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              />
              {nameInvalid && (
                <p role="alert" className="text-xs text-danger">
                  {t("perfiles.editor.name.error")}
                </p>
              )}
            </div>
          </div>

          <div className={PANEL_CLASS}>
            <div className="space-y-2">
              <label htmlFor="profile-editor-prompt" className={FIELD_LABEL_CLASS}>
                <IconLabel icon={<Sparkles size={14} />}>{t("perfiles.editor.prompt.label")}</IconLabel>
              </label>
              <textarea
                id="profile-editor-prompt"
                value={systemPrompt}
                onChange={(event) => setSystemPrompt(event.target.value)}
                rows={5}
                placeholder={t("perfiles.editor.prompt.placeholder")}
                className="w-full rounded-md border border-border bg-background px-3 py-2 max-h-[350px] min-h-[50px] text-sm text-foreground placeholder:text-dim focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              />
              {mode === "edit" && profileDetail.isError && (
                <p role="alert" className="text-xs text-danger">
                  {t("perfiles.editor.prompt.error")}
                </p>
              )}
            </div>

            <div className="flex flex-col gap-2 border-t border-border-soft pt-3">
              <label htmlFor="profile-editor-warmth" className={`block ${FIELD_LABEL_CLASS}`}>
                <IconLabel icon={<Flame size={14} />}>{t("perfiles.editor.warmth.label")}</IconLabel>
              </label>
              <p data-testid="warmth-current" className="text-[13px] font-semibold text-foreground">
                {t(`perfiles.editor.warmth.${warmth}.label` as TKey)} <span aria-hidden="true">›</span>
              </p>
              <div className="relative h-5">
                <div className="absolute inset-x-0 top-1/2 h-2 -translate-y-1/2 rounded-full bg-surface-2" />
                <div
                  className="absolute left-0 top-1/2 h-2 -translate-y-1/2 rounded-full bg-primary"
                  style={{ width: `${warmthPct}%` }}
                />
                {PROFILE_WARMTHS.map((level, i) => (
                  <span
                    key={level}
                    aria-hidden="true"
                    className="absolute top-1/2 h-1 w-1 -translate-x-1/2 -translate-y-1/2 rounded-full bg-background/60"
                    style={{ left: `${(i / (PROFILE_WARMTHS.length - 1)) * 100}%` }}
                  />
                ))}
                <input
                  id="profile-editor-warmth"
                  type="range"
                  min={0}
                  max={PROFILE_WARMTHS.length - 1}
                  step={1}
                  value={warmthIndex}
                  onChange={(e) => setWarmth(PROFILE_WARMTHS[Number(e.target.value)] ?? "cold")}
                  aria-valuetext={t(`perfiles.editor.warmth.${warmth}.label` as TKey)}
                  className="peer absolute inset-0 h-full w-full cursor-pointer opacity-0"
                />
                <span
                  aria-hidden="true"
                  className="pointer-events-none absolute top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-primary bg-background shadow peer-focus-visible:ring-2 peer-focus-visible:ring-ring"
                  style={{ left: `${warmthPct}%` }}
                />
              </div>
              <p className="text-xs text-muted-foreground">{t(`perfiles.editor.warmth.${warmth}.hint` as TKey)}</p>
              <p className="text-xs text-dim">{t("perfiles.editor.warmth.note")}</p>
            </div>

            <div className="flex flex-col gap-2 border-t border-border-soft pt-3">
              <span id="profile-editor-owner-gender-label" className={`block ${FIELD_LABEL_CLASS}`}>
                <IconLabel icon={<Users size={14} />}>{t("perfiles.editor.ownerGender.label")}</IconLabel>
              </span>
              <Select
                aria-labelledby="profile-editor-owner-gender-label"
                value={ownerGender}
                onChange={(value) => setOwnerGender(value as ProfileOwnerGender)}
                options={PROFILE_OWNER_GENDERS.map((value) => ({
                  value,
                  label: t(`perfiles.editor.ownerGender.${value || "unspecified"}` as TKey)
                }))}
              />
              <p className="text-xs text-muted-foreground">{t("perfiles.editor.ownerGender.hint")}</p>
            </div>
          </div>

          <div className={PANEL_CLASS}>
            <div
              role="group"
              aria-labelledby="profile-editor-extended-responses-label"
              className="grid grid-cols-[1fr_auto] items-center gap-3"
            >
              <div className="space-y-1">
                <span id="profile-editor-extended-responses-label" className={`block ${FIELD_LABEL_CLASS}`}>
                  <IconLabel icon={<AlignLeft size={14} />}>{t("perfiles.editor.extendedResponses.label")}</IconLabel>
                </span>
                <span className="text-[13px] text-foreground">{t("perfiles.editor.extendedResponses.hint")}</span>
              </div>
              <Switch
                checked={extendedResponses}
                onChange={setExtendedResponses}
                aria-label={t("perfiles.editor.extendedResponses.label")}
              />
            </div>

            <div className="grid grid-cols-[1fr_auto] items-center gap-3 border-t border-border-soft pt-3">
              <div className="space-y-1">
                <span className={`block ${FIELD_LABEL_CLASS}`}>
                  <IconLabel icon={<History size={14} />}>
                    {t("perfiles.editor.maxTurns.label", { max: maxTurnsCap })}
                  </IconLabel>
                </span>
                <span className="text-[13px] text-foreground">{t("perfiles.editor.maxTurns.hint", { max: maxTurnsCap })}</span>
              </div>
              <div className="w-20">
                <input
                  id="profile-editor-max-turns"
                  type="number"
                  min={1}
                  max={maxTurnsCap}
                  value={maxTurns}
                  onChange={(event) => {
                    const val = parseInt(event.target.value, 10);
                    if (!isNaN(val)) {
                      setMaxTurns(Math.max(1, Math.min(val, maxTurnsCap)));
                    }
                  }}
                  aria-label={t("perfiles.editor.maxTurns.label", { max: maxTurnsCap })}
                  className="h-9 w-full rounded-md border border-border bg-background px-3 text-center text-sm font-semibold text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                />
              </div>
            </div>
          </div>

          <div className={PANEL_CLASS}>
            <div className="grid grid-cols-[1fr_auto] items-center gap-3">
              <div className="space-y-1">
                <span id="profile-editor-use-system-label" className={`block ${FIELD_LABEL_CLASS}`}>
                  <IconLabel icon={<Cpu size={14} />}>{t("perfiles.editor.useSystem.label")}</IconLabel>
                </span>
                <span className="text-[13px] text-foreground">{t("perfiles.editor.useSystem.hint")}</span>
              </div>
              <Switch
                checked={useSystem}
                onChange={setUseSystem}
                aria-label={t("perfiles.editor.useSystem.label")}
              />
            </div>
            <Alert role="status" tone={useSystem ? "info" : "neutral"} className="text-xs">
              {useSystem
                ? t("perfiles.editor.useSystem.notice.enabled")
                : t("perfiles.editor.useSystem.notice.disabled")}
            </Alert>
          </div>

          {mode === "edit" && purgeFailedAfterDelete ? (
            // The profile itself is already gone at this point: only the
            // purge can be retried, never the delete again.
            <div className="flex flex-col gap-2">
              <Alert tone="danger">
                {t("perfiles.editor.delete.purgeFailed.notice", { name: initialName })}
              </Alert>
              <div className="flex justify-end">
                <Button
                  type="button"
                  variant="outline"
                  disabled={purgeMutation.isPending}
                  onClick={handleRetryPurge}
                >
                  {purgeMutation.isPending
                    ? t("perfiles.editor.delete.retryPurge.action.pending")
                    : t("perfiles.editor.delete.retryPurge.action")}
                </Button>
              </div>
            </div>
          ) : null}

          {saveError && (
            <p role="alert" className="text-xs leading-relaxed text-danger">
              {saveError.message ?? t("perfiles.editor.save.error")}
            </p>
          )}

          {/* Footer buttons MUTATE while confirming a delete: Cancelar/Guardar
              are replaced by ConfirmFooter's Cancelar/Eliminar perfil (no new
              buttons appear). Leaving confirm mode restores Cancelar/Guardar. */}
          {purgeFailedAfterDelete ? null : deleting ? (
            <div className="flex flex-col gap-3 border-t border-border-soft pt-3.5">
              {deleteMutation.isError && (
                <Alert tone="danger">
                  {deleteMutation.error?.message ?? t("perfiles.editor.delete.error")}
                </Alert>
              )}
              <ConfirmFooter
                active
                stages={[
                  {
                    message: t("perfiles.editor.delete.confirm.message", { name: initialName }),
                    acknowledgment: t("perfiles.editor.delete.confirm.acknowledgment"),
                    advanceLabel: t("perfiles.editor.delete.confirm.advance.action")
                  }
                ]}
                onConfirm={handleConfirmDelete}
                onCancel={() => setDeleting(false)}
                busy={deleteMutation.isPending}
              >
                <ConfirmToggle
                  tone="neutral"
                  pressed={purgeMemory}
                  onToggle={() => setPurgeMemory((value) => !value)}
                >
                  {t("perfiles.editor.delete.purgeToggle.label")}
                </ConfirmToggle>
              </ConfirmFooter>
            </div>
          ) : (
            <div className="flex items-center justify-between gap-3 border-t border-border-soft pt-3.5">
              {mode === "edit" && (
                <Button
                  type="button"
                  variant="ghost"
                  className="text-danger hover:text-danger"
                  onClick={() => setDeleting(true)}
                >
                  <Trash2 aria-hidden="true" size={14} className="mr-1.5" />
                  {t("perfiles.editor.delete.action")}
                </Button>
              )}
              <Button type="button" variant="ghost" className="ml-auto" onClick={onClose}>
                {t("perfiles.editor.cancel.action")}
              </Button>
              <button type="submit" className={SAVE_BUTTON_CLASS} disabled={savePending}>
                {savePending ? t("perfiles.editor.save.action.pending") : t("perfiles.editor.save.action")}
              </button>
            </div>
          )}
        </form>
      </Card>
    </Dialog>
  );
}
