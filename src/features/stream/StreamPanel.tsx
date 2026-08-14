import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { Card } from "../../ui/Card.js";
import { Alert } from "../../ui/Alert.js";
import { Badge } from "../../ui/Badge.js";
import type { BadgeTone } from "../../ui/Badge.js";
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
import { composeStreamUrl } from "../commands/wire.js";
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
// Input Contract switch: this is NOT the `filter_policy` preset (a separate
// 3-way value — balanced/twitch_relaxed/strict — already wired through the
// /acciones command stepper, see features/commands/wire.ts's FILTER_POLICY).
// It maps 1:1 to its own `input_contract` boolean on GET/PUT
// .../chat-live* — the `USE_INPUT_CONTRACT_PROMPT` module flag
// (opencohost/smart_aggregator/chat_input_contract.py), the same one the
// legacy CTK Stream admin panel already toggles. Wired end to end below —
// see AccionesCard.
//
// Orden / Vigencia (stream_over_agenda / stream_ttl_seconds): same
// GET/PUT .../chat-live* contract, wired the same way as Input Contract
// above. The two interact — agenda-first (stream_over_agenda: false) queues
// viewer reactions longer, so the backend floors the TTL actually in force
// (effective_stream_ttl_seconds, read-only) to 300s regardless of the
// streamer's chosen stream_ttl_seconds. AccionesCard discloses the gap
// whenever the two differ instead of silently honoring the floor — see the
// Alert in the Vigencia section.
//
// Small Stream (stream.acciones.smallStream.*): same GET/PUT .../chat-live*
// contract, CTK parity for stream_admin_ui.py's `switch_stream_small` /
// _dispatch_toggle_small_stream. Real incident, 2026-08-14: an 11-minute
// low-traffic Twitch session peaked at 0.333 accepted msg/s — below even
// this panel's lowest 0.5 msg/s reaction preset — so ActivityTrigger's
// threshold*window accepted-message floor was never reachable and Kira
// reacted zero times. ON sends threshold_per_second/cooldown_seconds/
// max_messages_per_user together in a single PUT; unlike the CTK original,
// OFF here also restores the spam default (CTK's OFF path leaves spam at
// 30 — see SMALL_STREAM_OFF below for why that's a deliberate deviation,
// not a port bug).

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

// Shared by both trailing-button states so the toggle doesn't restyle itself
// when it flips label/role.
const TRAILING_BUTTON_CLASS =
  "flex items-center px-4 text-sm font-semibold bg-[image:var(--accent-grad)] text-[var(--accent-contrast)] transition-opacity duration-fast ease-io disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";

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

  // Owner report: the field never reflected the live connection. It seeds from
  // STREAM_FIXTURE.url (which is "") and nothing ever wrote to it but the
  // operator's own keystrokes, so a reload against an already-connected backend
  // left an EMPTY box above a "conectado" badge — no way to tell which channel
  // was actually live without leaving the app.
  // StreamChatLiveResponse carries no raw URL (platform + source_id only),
  // so this reconstructs the same normalized form composeStreamUrl already
  // builds for the /vivo command path — not the literal string the operator
  // once typed, but an honest, non-fabricated stand-in for it.
  // Gated on `connected`: the Input is disabled below whenever connected is
  // true, so this can never stomp on a URL the operator is mid-typing — that
  // only happens while disconnected, exactly when this effect is a no-op.
  useEffect(() => {
    const data = chatLiveQuery.data;
    if (!data?.connected || !data.source_id) return;
    setUrl(composeStreamUrl(data.platform ?? "", data.source_id));
  }, [chatLiveQuery.data]);

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

  const toggleBusy = connectMutation.isPending || disconnectMutation.isPending;

  return (
    <Card className="flex flex-col p-4 gap-0 mb-2">
      <CollapsibleHeader isOpen={isOpen} onToggle={toggle}>
        <h2 className="text-sm font-bold text-foreground">{t("stream.chatLive.title")}</h2>
        <Badge className="ml-auto" tone={badge.tone}>{t(badge.labelKey)}</Badge>
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
                  connectionState === "conectado" ? (
                    // type="button": this must never trigger the form's own
                    // onSubmit (handleConnect) — its job is the opposite.
                    <button type="button" disabled={toggleBusy} onClick={handleDisconnect} className={TRAILING_BUTTON_CLASS}>
                      {t("stream.chatLive.disconnect.action")}
                    </button>
                  ) : (
                    <button type="submit" disabled={toggleBusy} className={TRAILING_BUTTON_CLASS}>
                      {t("stream.chatLive.connect.action")}
                    </button>
                  )
                }
              />
            </form>
            {error && (
              <p role="alert" className="text-xs text-danger">
                {t(error)}
              </p>
            )}
          </section>
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

// Small Stream ON — CTK's exact values (stream_admin_ui.py:1265-1266). Both
// 0.2 msg/s and 20s sit below anything REACTION_PRESET_VALUES/
// COOLDOWN_PRESET_VALUES can express (0.5/1/3 and 30/45/60/120), so a backend
// state matching both is an unambiguous signal that this switch — and
// nothing else reachable from the UI — turned it on. See smallStreamOn below.
const SMALL_STREAM_ON = { threshold_per_second: 0.2, cooldown_seconds: 20, max_messages_per_user: 30 } as const;

// Small Stream OFF — smart_aggregator.yaml's own defaults (activity.
// threshold_per_second: 1.0, activity.cooldown_seconds: 45.0, spam.
// max_messages_per_user: 10), i.e. exactly what the backend already reverts
// to on restart since it never persists these fields. The CTK's OFF path
// (stream_admin_ui.py:1268-1275) only restores threshold/cooldown and leaves
// spam wherever ON last set it (30). This panel's OFF restores spam as well,
// so that OFF means one state instead of two — otherwise a toggle round trip
// would leave the spam limit tripled with no control showing it. A superset
// of CTK's behavior, chosen here rather than inherited from it.
const SMALL_STREAM_OFF = { threshold_per_second: 1, cooldown_seconds: 45, max_messages_per_user: 10 } as const;

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

// stream_ttl_seconds has no CTK-derived preset, so this is Select-only —
// same shape as buildSpamOptions above. 300s is the backend's own floor
// (see effective_stream_ttl_seconds's docstring in api/stream.ts) so it's
// included as a selectable value, not just an implicit minimum.
function buildTtlOptions(t: ReturnType<typeof useT>) {
  return [
    { value: "60", label: t("stream.acciones.ttlOption.60") },
    { value: "120", label: t("stream.acciones.ttlOption.120") },
    { value: "300", label: t("stream.acciones.ttlOption.300") },
    { value: "600", label: t("stream.acciones.ttlOption.600") }
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
  const ttlOptions = buildTtlOptions(t);
  const presetOptions = buildPresetOptions(t);

  const [reactionThreshold, setReactionThreshold] = useState(STREAM_FIXTURE.reaction_threshold);
  const [cooldown, setCooldown] = useState(STREAM_FIXTURE.cooldown);
  const [spamLimit, setSpamLimit] = useState(STREAM_FIXTURE.spam_limit);
  const [inputContract, setInputContract] = useState(STREAM_FIXTURE.input_contract);
  const [streamOverAgenda, setStreamOverAgenda] = useState(STREAM_FIXTURE.stream_over_agenda);
  const [streamTtl, setStreamTtl] = useState(STREAM_FIXTURE.stream_ttl_seconds);

  useEffect(() => {
    if (!chatLiveQuery.data) return;
    setReactionThreshold(String(chatLiveQuery.data.threshold_per_second));
    setCooldown(String(chatLiveQuery.data.cooldown_seconds));
    setSpamLimit(String(chatLiveQuery.data.max_messages_per_user));
    setInputContract(chatLiveQuery.data.input_contract);
    setStreamOverAgenda(chatLiveQuery.data.stream_over_agenda);
    setStreamTtl(String(chatLiveQuery.data.stream_ttl_seconds));
  }, [chatLiveQuery.data]);

  // Undefined until the GET resolves — the disclosure only has an honest
  // answer once real chosen/effective values are in hand, so it stays quiet
  // (not "wrongly quiet", genuinely unknown) during that first render.
  const ttlDiverges =
    chatLiveQuery.data !== undefined &&
    chatLiveQuery.data.stream_ttl_seconds !== chatLiveQuery.data.effective_stream_ttl_seconds;

  const reactionPreset = presetForValue(reactionThreshold, REACTION_PRESET_VALUES);
  const cooldownPreset = presetForValue(cooldown, COOLDOWN_PRESET_VALUES);

  // Deliberately NOT local state like reactionThreshold/cooldown/spamLimit
  // above — the backend never persists these three fields, so a restart
  // silently reverts them to smart_aggregator.yaml's defaults, and this
  // switch must read that back honestly as OFF instead of trusting a stale
  // local flag. Undefined-safe the same way ttlDiverges is above.
  const smallStreamOn =
    chatLiveQuery.data !== undefined &&
    chatLiveQuery.data.threshold_per_second === SMALL_STREAM_ON.threshold_per_second &&
    chatLiveQuery.data.cooldown_seconds === SMALL_STREAM_ON.cooldown_seconds &&
    chatLiveQuery.data.max_messages_per_user === SMALL_STREAM_ON.max_messages_per_user;

  const pending = limitsMutation.isPending;

  return (
    <Card className="flex flex-col p-4">
      <CollapsibleHeader isOpen={isOpen} onToggle={toggle}>
        <h2 className="text-sm font-bold text-foreground">{t("stream.acciones.title")}</h2>
        {pending && <Badge tone="info">{t("stream.acciones.status.applying")}</Badge>}
      </CollapsibleHeader>

      <CollapsibleBody isOpen={isOpen}>
        <div className="flex flex-col gap-3">
          {/* Owner report: "applying…" vanished with nothing left behind, so a
              failed apply and a successful one looked identical once the
              badge cleared. isSuccess/isError reflect the LAST attempt and
              reset the moment the next mutate() call fires — no separate
              timer/toast state needed. */}
          {limitsMutation.isSuccess && (
            <Alert tone="ok" role="status" className="mb-3.5">
              {t("stream.acciones.status.applied")}
            </Alert>
          )}
          {limitsMutation.isError && (
            <Alert tone="danger" className="mb-3.5">
              {t("stream.acciones.status.error")}
            </Alert>
          )}

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

          <section aria-labelledby="stream-small-stream-label" className="space-y-2.5 border-t border-border-soft pt-3.5">
            <span
              id="stream-small-stream-label"
              className="text-[11px] font-semibold uppercase tracking-[0.09em] text-dim"
            >
              {t("stream.acciones.smallStream.eyebrow")}
            </span>
            <div className="space-y-2">
              <span id="stream-small-stream-helper" className="text-xs text-muted-foreground">
                {t("stream.acciones.smallStream.helper")}
              </span>
              <div className="grid grid-cols-[1fr_auto] items-center gap-3">
                <span className="text-[13px] text-foreground">{t("stream.acciones.smallStream.label")}</span>
                <Switch
                  checked={smallStreamOn}
                  disabled={limitsMutation.isPending}
                  onChange={(value) => limitsMutation.mutate(value ? SMALL_STREAM_ON : SMALL_STREAM_OFF)}
                  aria-label={t("stream.acciones.smallStream.aria")}
                />
              </div>
            </div>
          </section>

          <section aria-labelledby="stream-order-label" className="space-y-2.5 border-t border-border-soft pt-3.5">
            <span id="stream-order-label" className="text-[11px] font-semibold uppercase tracking-[0.09em] text-dim">
              {t("stream.acciones.order.eyebrow")}
            </span>
            <div className="space-y-2">
              <span id="stream-order-helper" className="text-xs text-muted-foreground">
                {t("stream.acciones.order.helper")}
              </span>
              <div className="grid grid-cols-[1fr_auto] items-center gap-3">
                <span className="text-[13px] text-foreground">{t("stream.acciones.order.label")}</span>
                <Switch
                  checked={streamOverAgenda}
                  disabled={limitsMutation.isPending}
                  onChange={(value) => {
                    setStreamOverAgenda(value);
                    limitsMutation.mutate({ stream_over_agenda: value });
                  }}
                  aria-label={t("stream.acciones.order.aria")}
                />
              </div>
            </div>
          </section>

          <section aria-labelledby="stream-ttl-label" className="space-y-2.5 border-t border-border-soft pt-3.5">
            <span id="stream-ttl-label" className="text-[11px] font-semibold uppercase tracking-[0.09em] text-dim">
              {t("stream.acciones.ttl.eyebrow")}
            </span>
            <div className="space-y-2">
              <span id="stream-ttl-helper" className="text-xs text-muted-foreground">
                {t("stream.acciones.ttl.helper")}
              </span>
              <Select
                aria-label={t("stream.acciones.ttl.select.aria")}
                aria-describedby="stream-ttl-helper"
                options={ttlOptions}
                value={streamTtl}
                disabled={limitsMutation.isPending}
                onChange={(value) => {
                  setStreamTtl(value);
                  limitsMutation.mutate({ stream_ttl_seconds: Number(value) });
                }}
              />
            </div>
            {/* The trap: agenda-first floors the effective TTL to 300s so a
                short chosen value can't silently starve every queued
                reaction. tone="info" + role="status" (not "alert"/danger) —
                this is the floor protecting the streamer, not a failure. */}
            {ttlDiverges && chatLiveQuery.data && (
              <Alert tone="info" role="status" title={t("stream.acciones.ttl.effectiveNotice.title")}>
                {t("stream.acciones.ttl.effectiveNotice.body", {
                  chosen: String(chatLiveQuery.data.stream_ttl_seconds),
                  effective: String(chatLiveQuery.data.effective_stream_ttl_seconds)
                })}
              </Alert>
            )}
          </section>

          <section aria-labelledby="stream-input-contract-label" className="space-y-2.5 border-t border-border-soft pt-3.5">
            <span
              id="stream-input-contract-label"
              className="text-[11px] font-semibold uppercase tracking-[0.09em] text-dim"
            >
              {t("stream.acciones.inputContract.eyebrow")}
            </span>
            <div className="space-y-2">
              <span id="stream-input-contract-helper" className="text-xs text-muted-foreground">
                {t("stream.acciones.inputContract.helper")}
              </span>
              <div className="grid grid-cols-[1fr_auto] items-center gap-3">
                <span className="text-[13px] text-foreground">{t("stream.acciones.inputContract.label")}</span>
                <Switch
                  checked={inputContract}
                  disabled={limitsMutation.isPending}
                  onChange={(value) => {
                    setInputContract(value);
                    limitsMutation.mutate({ input_contract: value });
                  }}
                  aria-label={t("stream.acciones.inputContract.aria")}
                />
              </div>
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
 * Acciones — including the Input Contract switch — are wired to the real
 * GET/POST/PUT /api/stream/chat-live* endpoints (see the wiring note at the
 * top of this file). Only the RF4 note stays deliberately non-wired — see
 * DeferredStreamAdminNote.
 *
 * RF3 (tauri_stream_chat_20260812): live chat READING now works — the feed
 * is mirrored read-only into the Stream tab of ConversationPanel (see
 * src/features/experiencia/StreamChatPanel.tsx) so the operator can follow
 * it without leaving whatever section they're on. This section stays the
 * place to connect/disconnect and tune limits — the banner below points at
 * where reading happens instead of claiming the whole section is inactive.
 */
export function StreamPanel() {
  const t = useT();
  return (
    <>
      <Alert tone="info" title={t("stream.chatReadout.title")} role="status">
        {t("stream.chatReadout.body")}
      </Alert>
      {/* Three themed alerts (not one, not a list-in-a-p — Alert.tsx wraps
          children in a single <p>) so the two consequential clauses, ban
          risk and the cloud-provider data disclosure, each get their own
          bold title instead of hiding inside a wall of caveats. */}
      <Alert tone="warn" title={t("stream.riskDisclaimer.beta.title")} role="status">
        {t("stream.riskDisclaimer.beta.body")}
      </Alert>
      <Alert tone="danger" title={t("stream.riskDisclaimer.platform.title")} role="status">
        {t("stream.riskDisclaimer.platform.body")}
      </Alert>
      <Alert tone="info" title={t("stream.riskDisclaimer.dataDisclosure.title")} role="status">
        {t("stream.riskDisclaimer.dataDisclosure.body")}
      </Alert>
      <ChatLiveCard />
      <AccionesCard />
      <DeferredStreamAdminNote />
    </>
  );
}
