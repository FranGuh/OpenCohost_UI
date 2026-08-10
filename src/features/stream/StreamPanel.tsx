import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { Card } from "../../ui/Card.js";
import { Alert } from "../../ui/Alert.js";
import { Badge } from "../../ui/Badge.js";
import type { BadgeTone } from "../../ui/Badge.js";
import { Button } from "../../ui/Button.js";
import { Input } from "../../ui/Input.js";
import { Select } from "../../ui/Select.js";
import { Segmented } from "../../ui/Segmented.js";
import { Switch } from "../../ui/Switch.js";
import { CollapsibleHeader, CollapsibleBody, useCollapsible } from "../../ui/Collapsible.js";
import { STREAM_FIXTURE, type StreamPresetLevel } from "../../api/mock/fixtures.js";
import {
  useStreamChatLiveQuery,
  useStreamConnectMutation,
  useStreamDisconnectMutation,
  useStreamLimitsMutation
} from "../../api/stream.js";
import { useT, type TKey } from "../../i18n/t.js";

// Wired to GET /api/stream/chat-live, POST .../connect, POST .../disconnect,
// PUT .../limits (opencohost/api/main.py ~549-624) — CTK parity:
// opencohost/ui/stream_admin_ui.py's 'acciones' subtab (Chat Live tab),
// wired to smart_agg.set_activity_limits / set_spam_limits and
// sanitize_live_url for the connect URL. R8-CRITICAL: the response is
// STATE + LIMITS ONLY (StreamChatLiveResponse) — never render anything but
// connection state and tuning values, never raw viewer chat.
//
// RF4 (OAuth connect, stream metadata, moderation) is a flagged USER-ASSIST
// product decision (STREAM_ADMIN_ENABLED=False in the CTK) and is
// deliberately NOT built here — see DeferredStreamAdminNote below.
//
// `filter_policy`/Input Contract switch: PUT .../limits DOES accept
// filter_policy (StreamLimitsRequest.filter_policy, main.py:620-624) — the
// endpoint exists. What's undecided is the product mapping from this
// boolean toggle to a filter_policy preset value, so the switch stays
// local-only/non-wired until that mapping is decided — see AccionesCard.

type StreamConnectionState = "desconectado" | "conectando" | "conectado";

const CONNECTION_BADGE: Record<StreamConnectionState, { tone: BadgeTone; labelKey: TKey }> = {
  desconectado: { tone: "neutral", labelKey: "stream.chatLive.status.desconectado" },
  conectando: { tone: "info", labelKey: "stream.chatLive.status.conectando" },
  conectado: { tone: "ok", labelKey: "stream.chatLive.status.conectado" }
};

// ponytail: shape-only check (protocol + a dotted host), not the CTK's full
// YouTube/Twitch id-extraction regex — good enough for a local mock, the
// real sanitize_live_url call happens server-side once the endpoint exists.
function isValidStreamUrl(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return false;
  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    return new URL(withProtocol).hostname.includes(".");
  } catch {
    return false;
  }
}

// StreamPanel used to carry a byte-identical local copy of CollapsibleHeader/
// CollapsibleBody; after the P6 token normalization the shared ui/Collapsible
// matches it exactly, so this panel now reuses the shared components (and its
// useCollapsible hook, which adds localStorage persistence).

// ─── Chat en vivo ─────────────────────────────────────────────────────────

function ChatLiveCard() {
  const t = useT();
  const [isOpen, toggle] = useCollapsible(true, "stream-chat-live");
  const [url, setUrl] = useState(STREAM_FIXTURE.url);
  // Holds the key, not the resolved message — see the render site below.
  const [error, setError] = useState<TKey | null>(null);
  const chatLiveQuery = useStreamChatLiveQuery();
  const connectMutation = useStreamConnectMutation();
  const disconnectMutation = useStreamDisconnectMutation();

  const connected = chatLiveQuery.data?.connected ?? false;
  const connectionState: StreamConnectionState = connectMutation.isPending
    ? "conectando"
    : connected
      ? "conectado"
      : "desconectado";
  const badge = CONNECTION_BADGE[connectionState];

  async function handleConnect(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = url.trim();
    if (!isValidStreamUrl(trimmed)) {
      setError("stream.chatLive.url.error");
      return;
    }
    setError(null);
    try {
      await connectMutation.mutateAsync(trimmed);
    } catch {
      setError("stream.chatLive.connect.error");
    }
  }

  function handleDisconnect() {
    disconnectMutation.mutate();
  }

  return (
    <Card className="flex flex-col p-4">
      <CollapsibleHeader isOpen={isOpen} onToggle={toggle}>
        <h2 className="text-sm font-bold text-foreground">{t("stream.chatLive.title")}</h2>
        <Badge tone={badge.tone}>{t(badge.labelKey)}</Badge>
      </CollapsibleHeader>

      <CollapsibleBody isOpen={isOpen}>
        <div className="flex flex-col gap-3.5">
          <section aria-labelledby="stream-url-label" className="space-y-2">
            <span id="stream-url-label" className="text-[11px] font-semibold uppercase tracking-[0.09em] text-dim">
              {t("stream.chatLive.connection.eyebrow")}
            </span>
            <form onSubmit={(event) => void handleConnect(event)}>
              <Input
                type="text"
                aria-label={t("stream.chatLive.url.aria")}
                value={url}
                disabled={connectMutation.isPending || connectionState === "conectado"}
                onChange={(event) => setUrl(event.target.value)}
                placeholder={t("stream.chatLive.url.placeholder")}
                trailing={
                  <button
                    type="submit"
                    disabled={connectMutation.isPending || connectionState === "conectado"}
                    className="flex items-center px-4 text-sm font-semibold bg-[image:var(--accent-grad)] text-[var(--accent-contrast)] transition-opacity duration-fast ease-io disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                  >
                    {t("stream.chatLive.connect.action")}
                  </button>
                  // Este boton deberia heredar la misma responsabilidad de descoenctar y el boton de abajo de desconectar deberia ser eliminado
                }
              />
            </form>
            {error && (
              <p role="alert" className="text-xs text-danger">
                {t(error)}
              </p>
            )}
          </section>

          <div className="grid grid-cols-[1fr_auto] items-center gap-3">
            <span className="text-[13px] text-foreground">{t("stream.chatLive.disconnect.hint")}</span>
            <Button
              type="button"
              variant="outline"
              disabled={connectionState !== "conectado" || disconnectMutation.isPending}
              onClick={handleDisconnect}
            >
              {t("stream.chatLive.disconnect.action")}
            </Button>
          </div>
        </div>
      </CollapsibleBody>
    </Card>
  );
}

// ─── Acciones option sets ─────────────────────────────────────────────────
// Built as functions of `t` (not module-level consts) so they hot-swap with
// the locale — mirrors MemoryCard's buildImportSources / buildTierOptions.

// CTK-derived preset->value maps (opencohost/ui/stream_admin_ui.py
// _build_chat_live_tab): threshold presets are 0.5/1/3 msg/s, cooldown
// presets are 30/60/120s, in bajo/medio/alto order.
//
// The option builders below read these instead of repeating the numbers. The
// preset highlight compares a Select's current value against this map, so two
// independent copies of the same numbers would let the option list drift until
// the highlight silently stopped matching — with nothing able to fail.
const REACTION_PRESET_VALUES = {
  bajo: "0.5",
  medio: "1",
  alto: "3"
} as const satisfies Record<StreamPresetLevel, string>;

const COOLDOWN_PRESET_VALUES = {
  bajo: "30",
  medio: "60",
  alto: "120"
} as const satisfies Record<StreamPresetLevel, string>;

function buildReactionOptions(t: ReturnType<typeof useT>) {
  return [
    { value: REACTION_PRESET_VALUES.bajo, label: t("stream.acciones.reactionOption.0_5") },
    { value: REACTION_PRESET_VALUES.medio, label: t("stream.acciones.reactionOption.1") },
    { value: REACTION_PRESET_VALUES.alto, label: t("stream.acciones.reactionOption.3") }
  ] as const;
}

function buildCooldownOptions(t: ReturnType<typeof useT>) {
  return [
    { value: COOLDOWN_PRESET_VALUES.bajo, label: t("stream.chatLive.cooldownOption.30") },
    // 45s is Select-only — it deliberately has no preset button.
    { value: "45", label: t("stream.chatLive.cooldownOption.45") },
    { value: COOLDOWN_PRESET_VALUES.medio, label: t("stream.chatLive.cooldownOption.60") },
    { value: COOLDOWN_PRESET_VALUES.alto, label: t("stream.chatLive.cooldownOption.120") }
  ] as const;
}

function buildSpamOptions(t: ReturnType<typeof useT>) {
  return [
    { value: "5", label: t("stream.acciones.spamOption.5") },
    { value: "10", label: t("stream.acciones.spamOption.10") },
    { value: "15", label: t("stream.acciones.spamOption.15") },
    { value: "20", label: t("stream.acciones.spamOption.20") }
  ] as const;
}

// Preset labels are resolved locally by `level` — the fixture's own `label`
// field is left untouched (it's mock data shaped like a future API
// response), see the batch report for why.
const PRESET_LABEL_KEYS: Record<StreamPresetLevel, TKey> = {
  bajo: "stream.acciones.preset.bajo",
  medio: "stream.acciones.preset.medio",
  alto: "stream.acciones.preset.alto"
};

function buildPresetOptions(t: ReturnType<typeof useT>): ReadonlyArray<{ value: StreamPresetLevel; label: string }> {
  return STREAM_FIXTURE.presets.map((preset) => ({ value: preset.level, label: t(PRESET_LABEL_KEYS[preset.level]) }));
}

// Preset highlight is derived from the current value (not tracked as its
// own state) so it can never drift out of sync with the Select — returns
// null when no preset maps to the value, which Segmented renders as
// "nothing pressed" instead of a stale default.
function presetForValue<T extends string>(value: string, presetValues: Record<T, string>): T | null {
  const match = (Object.entries(presetValues) as Array<[T, string]>).find(([, presetValue]) => presetValue === value);
  return match ? match[0] : null;
}

// ─── Acciones ─────────────────────────────────────────────────────────────

function AccionesCard() {
  const t = useT();
  const [isOpen, toggle] = useCollapsible(true, "stream-acciones");
  const chatLiveQuery = useStreamChatLiveQuery();
  const limitsMutation = useStreamLimitsMutation();
  const reactionOptions = buildReactionOptions(t);
  const cooldownOptions = buildCooldownOptions(t);
  const spamOptions = buildSpamOptions(t);
  const presetOptions = buildPresetOptions(t);

  const [reactionThreshold, setReactionThreshold] = useState(STREAM_FIXTURE.reaction_threshold);
  const [cooldown, setCooldown] = useState(STREAM_FIXTURE.cooldown);
  const [spamLimit, setSpamLimit] = useState(STREAM_FIXTURE.spam_limit);
  const [inputContract, setInputContract] = useState(STREAM_FIXTURE.input_contract);

  useEffect(() => {
    if (!chatLiveQuery.data) return;
    setReactionThreshold(String(chatLiveQuery.data.threshold_per_second));
    setCooldown(String(chatLiveQuery.data.cooldown_seconds));
    setSpamLimit(String(chatLiveQuery.data.max_messages_per_user));
  }, [chatLiveQuery.data]);

  const reactionPreset = presetForValue(reactionThreshold, REACTION_PRESET_VALUES);
  const cooldownPreset = presetForValue(cooldown, COOLDOWN_PRESET_VALUES);

  const pending = limitsMutation.isPending;

  return (
    <Card className="flex flex-col p-4">
      <CollapsibleHeader isOpen={isOpen} onToggle={toggle}>
        <h2 className="text-sm font-bold text-foreground">{t("stream.acciones.title")}</h2>
        {pending && <Badge tone="info">{t("stream.acciones.status.applying")}</Badge>}
      </CollapsibleHeader>

      <CollapsibleBody isOpen={isOpen}>
        <div className="flex flex-col gap-3">
          {/* Deferred note — local-only filter_policy switch */}
          <div role="status" className="mb-3.5 rounded-md border border-warn-bd bg-warn-bg px-3 py-2.5">
            <p className="text-xs leading-relaxed text-muted-foreground">
              {t("stream.acciones.inputContract.notice.before")}{" "}
              <span className="mono text-warn">filter_policy</span>
              {t("stream.acciones.inputContract.notice.after")}
            </p>
          </div>

          <section aria-labelledby="stream-reactions-label" className="space-y-2.5 border-t border-border-soft pt-3.5">
            <span id="stream-reactions-label" className="text-[11px] font-semibold uppercase tracking-[0.09em] text-dim">
              {t("stream.acciones.reactions.eyebrow")}
            </span>
            <div className="space-y-2">
              <span id="stream-reaction-helper" className="text-xs text-muted-foreground">
                {t("stream.acciones.reactions.helper")}
              </span>
              <Select
                aria-label={t("stream.acciones.reactions.select.aria")}
                aria-describedby="stream-reaction-helper"
                options={reactionOptions}
                value={reactionThreshold}
                disabled={limitsMutation.isPending}
                onChange={(value) => {
                  setReactionThreshold(value);
                  limitsMutation.mutate({ threshold_per_second: Number(value) });
                }}
              />
            </div>
            <Segmented
              ariaLabel={t("stream.acciones.reactions.preset.aria")}
              options={presetOptions}
              value={reactionPreset}
              disabled={limitsMutation.isPending}
              onChange={(level) => {
                const value = REACTION_PRESET_VALUES[level];
                setReactionThreshold(value);
                limitsMutation.mutate({ threshold_per_second: Number(value) });
              }}
            />
          </section>

          <section aria-labelledby="stream-cooldown-label" className="space-y-2.5 border-t border-border-soft pt-3.5">
            <span id="stream-cooldown-label" className="text-[11px] font-semibold uppercase tracking-[0.09em] text-dim">
              {t("stream.acciones.cooldown.eyebrow")}
            </span>
            <div className="space-y-2">
              <span id="stream-cooldown-helper" className="text-xs text-muted-foreground">
                {t("stream.acciones.cooldown.helper")}
              </span>
              <Select
                aria-label={t("stream.acciones.cooldown.select.aria")}
                aria-describedby="stream-cooldown-helper"
                options={cooldownOptions}
                value={cooldown}
                disabled={limitsMutation.isPending}
                onChange={(value) => {
                  setCooldown(value);
                  limitsMutation.mutate({ cooldown_seconds: Number(value) });
                }}
              />
            </div>
            <Segmented
              ariaLabel={t("stream.acciones.cooldown.preset.aria")}
              options={presetOptions}
              value={cooldownPreset}
              disabled={limitsMutation.isPending}
              onChange={(level) => {
                const value = COOLDOWN_PRESET_VALUES[level];
                setCooldown(value);
                limitsMutation.mutate({ cooldown_seconds: Number(value) });
              }}
            />
          </section>

          <section aria-labelledby="stream-spam-label" className="space-y-2.5 border-t border-border-soft pt-3.5">
            <span id="stream-spam-label" className="text-[11px] font-semibold uppercase tracking-[0.09em] text-dim">
              {t("stream.acciones.spam.eyebrow")}
            </span>
            <div className="space-y-2">
              <span id="stream-spam-helper" className="text-xs text-muted-foreground">
                {t("stream.acciones.spam.helper")}
              </span>
              <Select
                aria-label={t("stream.acciones.spam.select.aria")}
                aria-describedby="stream-spam-helper"
                options={spamOptions}
                value={spamLimit}
                disabled={limitsMutation.isPending}
                onChange={(value) => {
                  setSpamLimit(value);
                  limitsMutation.mutate({ max_messages_per_user: Number(value) });
                }}
              />
            </div>
          </section>

          <section aria-labelledby="stream-input-contract-label" className="space-y-2.5 border-t border-border-soft pt-3.5">
            <span
              id="stream-input-contract-label"
              className="text-[11px] font-semibold uppercase tracking-[0.09em] text-dim"
            >
              {t("stream.acciones.inputContract.eyebrow")}
            </span>
            <div className="grid grid-cols-[1fr_auto] items-center gap-3">
              <span className="text-[13px] text-foreground">{t("stream.acciones.inputContract.label")}</span>
              <Switch
                checked={inputContract}
                disabled
                onChange={() => {}}
                aria-label={t("stream.acciones.inputContract.aria")}
              />
            </div>
          </section>
        </div>
      </CollapsibleBody>
    </Card>
  );
}

// ─── Emisión (deferred) ───────────────────────────────────────────────────

/** RF4 (OAuth connect, stream metadata, moderation) is flagged off in the
 * CTK (STREAM_ADMIN_ENABLED=False) pending an owner product decision — this
 * is a single honest deferred note, nothing interactive. */
function DeferredStreamAdminNote() {
  const t = useT();
  const [isOpen, toggle] = useCollapsible(false, "stream-emision");

  return (
    <Card className="flex flex-col p-4">
      <CollapsibleHeader isOpen={isOpen} onToggle={toggle}>
        <h2 className="text-sm font-bold text-foreground w-full justify-between">{t("stream.acciones.emision.title")}</h2>
        <Badge tone="neutral">{t("stream.acciones.emision.badge")}</Badge>
      </CollapsibleHeader>

      <CollapsibleBody isOpen={isOpen}>
        <p role="status" className="text-xs leading-relaxed text-muted-foreground">
          {t("stream.acciones.emision.body")}
        </p>
      </CollapsibleBody>
    </Card>
  );
}

// ─── Public export ────────────────────────────────────────────────────────

/**
 * Stream panel — RF3 "Chat en vivo" only. CTK parity:
 * opencohost/ui/stream_admin_ui.py's 'acciones' subtab. Chat en vivo and
 * Acciones are wired to the real GET/POST/PUT /api/stream/chat-live*
 * endpoints (see the wiring note at the top of this file). Only the Input
 * Contract switch (pending the boolean->filter_policy mapping decision)
 * and the RF4 note stay deliberately non-wired — see AccionesCard and
 * DeferredStreamAdminNote.
 *
 * The actual chat sources (Twitch/YouTube ingestion) only run in the
 * deprecated CTK app, so this whole section is dormant on Tauri until that
 * migration lands — the banner below says so up front, ahead of the cards.
 */
export function StreamPanel() {
  const t = useT();
  return (
    <>
      <Alert tone="info" title={t("stream.notMigrated.title")} role="status">
        {t("stream.notMigrated.body")}
      </Alert>
      <ChatLiveCard />
      <AccionesCard />
      <DeferredStreamAdminNote />
    </>
  );
}
