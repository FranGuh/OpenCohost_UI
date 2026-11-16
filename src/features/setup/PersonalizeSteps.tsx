import { useEffect, useRef, useState } from "react";
import type { Dispatch } from "react";
import { useQuery } from "@tanstack/react-query";
import { ExternalLink } from "lucide-react";
import { getI18nState } from "../../api/i18n.js";
import { primaryLocale } from "../../api/profiles.js";
import {
  PERSONALIZATION_INTERESTS_MAX,
  PERSONALIZATION_NICKNAME_MAX,
  PERSONALIZATION_OCCUPATION_MAX,
  usePersonalizationQuery,
  useUpdatePersonalizationMutation
} from "../../api/personalization.js";
import { useTavilyKey } from "../../api/useTavilyKey.js";
import { openExternalUrl } from "../../lib/openUrl.js";
import { hasStoredPresentation, useAvatarPresentationStore, type AvatarPresentationMode } from "../../store/avatarPresentationStore.js";
import { ThemeSwitcher } from "../../theme/ThemeSwitcher.js";
import { Alert } from "../../ui/Alert.js";
import { Badge } from "../../ui/Badge.js";
import { Button } from "../../ui/Button.js";
import { Input } from "../../ui/Input.js";
import { useT } from "../../i18n/t.js";
import { useUiLocale } from "../../i18n/locale.js";
import { LIVEAUDIO_DOWNLOAD_URL } from "../controles/PTTCard.js";
import type { SetupEvent } from "./setupMachine.js";
import { ChoiceCard, type StepProps } from "./SetupSteps.js";

/** "Saltar": leave the screen without saving what was typed on it. */
function SkipButton({ dispatch }: { dispatch: Dispatch<SetupEvent> }) {
  const t = useT();
  return (
    <Button type="button" variant="ghost" onClick={() => dispatch({ type: "next" })}>
      {t("setup.personalize.skip")}
    </Button>
  );
}

/** The one yes/no that opens the optional block. "No" jumps straight to the summary. */
export function PersonalizeIntroStep({ dispatch }: { dispatch: Dispatch<SetupEvent> }) {
  const t = useT();
  return (
    <div className="flex max-w-xl flex-col gap-4">
      <p className="text-sm leading-relaxed text-muted-foreground">{t("setup.personalize.copy")}</p>
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="primary" onClick={() => dispatch({ type: "personalize", wants: true })}>
          {t("setup.personalize.yes")}
        </Button>
        <Button type="button" variant="outline" onClick={() => dispatch({ type: "personalize", wants: false })}>
          {t("setup.personalize.no")}
        </Button>
      </div>
      <p className="text-xs leading-relaxed text-dim">{t("setup.personalize.later")}</p>
    </div>
  );
}

/**
 * Avatar: Kira in 3D or her PNG images (the same presentation switch as
 * Controles › Avatar). The option that suits the PC is recommended and, when
 * nothing was ever chosen, preselected: 3D with a usable GPU, PNG otherwise
 * (an unknown GPU counts as none). A user's own avatar is not uploaded here;
 * a one-line note points to Controles. A choice applies at once, so the footer
 * Continue is the only way on (no separate skip).
 */
export function AvatarStep({ state }: StepProps) {
  const t = useT();
  const mode = useAvatarPresentationStore((s) => s.mode);
  const setMode = useAvatarPresentationStore((s) => s.setMode);
  const recommended: AvatarPresentationMode = state.hasGpu ? "3d" : "2d";

  // Preselect the recommendation once, and only over a default nobody picked.
  useEffect(() => {
    if (!hasStoredPresentation()) setMode(recommended);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per visit
  }, []);

  const options: ReadonlyArray<{ id: AvatarPresentationMode; title: string }> = [
    { id: "3d", title: t("setup.avatar.3d") },
    { id: "2d", title: t("setup.avatar.png") }
  ];

  return (
    <div className="flex max-w-xl flex-col gap-4">
      <p className="text-sm leading-relaxed text-muted-foreground">{t("setup.avatar.copy")}</p>
      <div role="group" aria-label={t("setup.avatar.aria")} className="grid gap-3 sm:grid-cols-2">
        {options.map((option) => (
          <ChoiceCard
            key={option.id}
            pressed={mode === option.id}
            onSelect={() => setMode(option.id)}
            title={option.title}
            badge={option.id === recommended ? t("setup.engine.recommended") : null}
            badgeTone="ok"
          />
        ))}
      </div>
      <p className="text-xs leading-relaxed text-dim">{t("setup.avatar.ownNote")}</p>
    </div>
  );
}

const TAVILY_KEY_URL = "https://app.tavily.com";
const LINK_CLASS =
  "inline-flex h-9 items-center justify-center gap-1.5 rounded-md border border-border bg-card px-4 text-sm font-semibold text-foreground transition-colors duration-fast ease-io hover:border-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";

function ExternalLinkButton({ url, label }: { url: string; label: string }) {
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      onClick={(event) => {
        event.preventDefault();
        void openExternalUrl(url);
      }}
      className={LINK_CLASS}
    >
      {label}
      <ExternalLink size={14} aria-hidden="true" />
    </a>
  );
}

function Field({ label, max, value, onChange }: { label: string; max: number; value: string; onChange(value: string): void }) {
  return (
    <label className="flex flex-col gap-1 text-sm font-semibold text-foreground">
      {label}
      <Input value={value} maxLength={max} autoComplete="off" onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

/**
 * Nickname plus optional occupation and interests, saved through the same
 * /api/personalization store as Memoria. Character editing (warmth, tone)
 * stays in Perfiles; this screen only points there. Its own "Guardar y seguir"
 * is the only way on that keeps what was typed (the footer has no Continue
 * here), and "Saltar" leaves without saving.
 */
export function ProfileStep({ dispatch }: StepProps) {
  const t = useT();
  const { locale: uiLocale } = useUiLocale();
  const i18nQuery = useQuery({ queryKey: ["i18n"], queryFn: getI18nState, staleTime: 60_000 });
  const i18nSettled = !i18nQuery.isPending;
  const rawLocale =
    (i18nQuery.data?.persisted_locale?.trim() || i18nQuery.data?.active_locale?.trim() || "") || uiLocale;
  const onboardingLocale = primaryLocale(rawLocale) || uiLocale;
  const { data, isPending: personalizationPending } = usePersonalizationQuery(onboardingLocale, {
    enabled: i18nSettled
  });
  const save = useUpdatePersonalizationMutation(onboardingLocale);
  const [nickname, setNickname] = useState("");
  const [occupation, setOccupation] = useState("");
  const [interests, setInterests] = useState("");
  const [touched, setTouched] = useState(false);
  const prevLocaleRef = useRef(onboardingLocale);

  // Re-running /setup shows what is already stored, until the user types.
  // Reset touched when onboardingLocale changes so the new locale hydrates cleanly.
  useEffect(() => {
    const localeChanged = prevLocaleRef.current !== onboardingLocale;
    if (localeChanged) {
      prevLocaleRef.current = onboardingLocale;
      setTouched(false);
    }
    if (touched && !localeChanged) return;
    if (!data) {
      setNickname("");
      setOccupation("");
      setInterests("");
      return;
    }
    setNickname(data.nickname);
    setOccupation(data.occupation);
    setInterests(data.interests);
  }, [data, onboardingLocale, touched]);

  function edit(setter: (value: string) => void) {
    return (value: string) => {
      setTouched(true);
      setter(value);
    };
  }

  // Guard Save while personalization is loading so `updated_at === null`
  // cannot race and silently drop `enabled: true` on first-time setup.
  const loading = !i18nSettled || personalizationPending;
  // Turn personalization on only the first time it is ever saved; a user who
  // switched it off in Memoria keeps it off.
  const neverConfigured = data?.updated_at === null;
  const filled = Boolean(nickname.trim() || occupation.trim() || interests.trim());
  const profileLanguageLabel =
    onboardingLocale === "es"
      ? t("setup.language.es")
      : onboardingLocale === "en"
        ? t("setup.language.en")
        : onboardingLocale.toUpperCase();
  const uiLanguageLabel = uiLocale === "es" ? t("setup.language.es") : t("setup.language.en");
  const localeDiffers = i18nSettled && onboardingLocale !== uiLocale;

  function handleSave() {
    if (loading) return;
    const fields = { nickname: nickname.trim(), occupation: occupation.trim(), interests: interests.trim() };
    save.mutate(neverConfigured ? { enabled: true, ...fields } : fields, { onSuccess: () => dispatch({ type: "next" }) });
  }

  return (
    <div className="flex max-w-xl flex-col gap-4">
      <p className="text-sm leading-relaxed text-muted-foreground">{t("setup.profile.copy")}</p>
      {i18nSettled && (
        <div className="flex flex-col gap-1.5">
          <Badge tone={localeDiffers ? "info" : "neutral"} className="self-start">
            {t("setup.profile.localeBadge", { language: profileLanguageLabel })}
          </Badge>
          {localeDiffers && (
            <p className="text-xs leading-relaxed text-muted-foreground">
              {t("setup.profile.localeMismatchNote", {
                uiLanguage: uiLanguageLabel,
                kiraLanguage: profileLanguageLabel
              })}
            </p>
          )}
        </div>
      )}
      <Field label={t("setup.profile.nickname")} max={PERSONALIZATION_NICKNAME_MAX} value={nickname} onChange={edit(setNickname)} />
      <Field label={t("setup.profile.occupation")} max={PERSONALIZATION_OCCUPATION_MAX} value={occupation} onChange={edit(setOccupation)} />
      <Field label={t("setup.profile.interests")} max={PERSONALIZATION_INTERESTS_MAX} value={interests} onChange={edit(setInterests)} />
      {save.isError && <Alert tone="warn" role="status">{t("setup.profile.error")}</Alert>}
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="primary" disabled={!filled || loading || save.isPending} onClick={handleSave}>
          {save.isPending ? t("setup.profile.saving") : t("setup.profile.save")}
        </Button>
        <SkipButton dispatch={dispatch} />
      </div>
      <p className="text-xs leading-relaxed text-dim">{t("setup.profile.character")}</p>
    </div>
  );
}

/**
 * Web search backup: the optional Tavily key. "Guardar y seguir" saves a typed
 * key (write-only: the field is cleared and a stored key is only ever reported
 * as "saved") before moving on; "Saltar" leaves without saving it.
 */
export function SearchStep({ dispatch }: StepProps) {
  const t = useT();
  const [saveFailed, setSaveFailed] = useState(false);
  const { query, mutation, draft, setDraft, save } = useTavilyKey();
  const data = query.data;
  const unavailable = data?.storage_available === false;
  const pendingKey = draft.trim();

  function handleSave() {
    if (!pendingKey || unavailable) return;
    setSaveFailed(false);
    save(pendingKey).then(
      () => dispatch({ type: "next" }),
      () => setSaveFailed(true)
    );
  }

  return (
    <div className="flex max-w-xl flex-col gap-4">
      <p className="text-sm leading-relaxed text-muted-foreground">{t("setup.extras.search.copy")}</p>
      {unavailable && <p className="text-xs text-muted-foreground">{t("setup.extras.search.unavailable")}</p>}
      <label className="flex flex-col gap-1 text-sm font-semibold text-foreground">
        {t("setup.extras.search.key")}
        <Input
          type="password"
          value={draft}
          autoComplete="off"
          spellCheck={false}
          maxLength={4096}
          disabled={unavailable || mutation.isPending}
          onChange={(event) => {
            setSaveFailed(false);
            setDraft(event.target.value);
          }}
        />
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <ExternalLinkButton url={TAVILY_KEY_URL} label={t("setup.extras.search.link")} />
        {data?.stored_key_set && <span className="text-sm font-medium text-ok">{t("setup.extras.search.saved")}</span>}
      </div>
      {saveFailed && <p role="status" className="text-xs text-danger">{t("setup.extras.search.error")}</p>}
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="primary" disabled={!pendingKey || unavailable || mutation.isPending} onClick={handleSave}>
          {mutation.isPending ? t("setup.profile.saving") : t("setup.profile.save")}
        </Button>
        <SkipButton dispatch={dispatch} />
      </div>
    </div>
  );
}

/** Info only: LiveAudio lets the user talk to Kira with their voice. The footer Continue moves on. */
export function LiveAudioStep() {
  const t = useT();
  return (
    <div className="flex max-w-xl flex-col gap-4">
      <p className="text-sm leading-relaxed text-muted-foreground">{t("setup.extras.voice.copy")}</p>
      <div>
        <ExternalLinkButton url={LIVEAUDIO_DOWNLOAD_URL} label={t("setup.extras.voice.link")} />
      </div>
    </div>
  );
}

/** The theme picker alone; it applies at once and the footer Continue moves on. */
export function ThemeStep() {
  return (
    <div className="flex max-w-xl flex-col gap-4">
      <ThemeSwitcher />
    </div>
  );
}
