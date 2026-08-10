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

const CONNECTION_BADGE: Record<StreamConnectionState, { tone: BadgeTone; label: string }> = {
  desconectado: { tone: "neutral", label: "desconectado" },
  conectando: { tone: "info", label: "conectando…" },
  conectado: { tone: "ok", label: "conectado" }
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
  const [isOpen, toggle] = useCollapsible(true, "stream-chat-live");
  const [url, setUrl] = useState(STREAM_FIXTURE.url);
  const [error, setError] = useState<string | null>(null);
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
      setError("Ingresá una URL válida de YouTube o Twitch (ej: https://twitch.tv/tu_canal).");
      return;
    }
    setError(null);
    try {
      await connectMutation.mutateAsync(trimmed);
    } catch {
      setError("No se pudo conectar al chat en vivo.");
    }
  }

  function handleDisconnect() {
    disconnectMutation.mutate();
  }

  return (
    <Card className="flex flex-col p-4">
      <CollapsibleHeader isOpen={isOpen} onToggle={toggle}>
        <h2 className="text-sm font-bold text-foreground">Chat en vivo</h2>
        <Badge tone={badge.tone}>{badge.label}</Badge>
      </CollapsibleHeader>

      <CollapsibleBody isOpen={isOpen}>
        <div className="flex flex-col gap-3.5">
          <section aria-labelledby="stream-url-label" className="space-y-2">
            <span id="stream-url-label" className="text-[11px] font-semibold uppercase tracking-[0.09em] text-dim">
              Conexión
            </span>
            <form onSubmit={(event) => void handleConnect(event)}>
              <Input
                type="text"
                aria-label="URL del directo"
                value={url}
                disabled={connectMutation.isPending || connectionState === "conectado"}
                onChange={(event) => setUrl(event.target.value)}
                placeholder="https://twitch.tv/tu_canal o https://youtube.com/watch?v=..."
                trailing={
                  <button
                    type="submit"
                    disabled={connectMutation.isPending || connectionState === "conectado"}
                    className="flex items-center px-4 text-sm font-semibold bg-[image:var(--accent-grad)] text-[var(--accent-contrast)] transition-opacity duration-fast ease-io disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                  >
                    Conectar
                  </button>
                  // Este boton deberia heredar la misma responsabilidad de descoenctar y el boton de abajo de desconectar deberia ser eliminado
                }
              />
            </form>
            {error && (
              <p role="alert" className="text-xs text-danger">
                {error}
              </p>
            )}
          </section>

          <div className="grid grid-cols-[1fr_auto] items-center gap-3">
            <span className="text-[13px] text-foreground">Desconectar del chat en vivo</span>
            <Button
              type="button"
              variant="outline"
              disabled={connectionState !== "conectado" || disconnectMutation.isPending}
              onClick={handleDisconnect}
            >
              Desconectar
            </Button>
          </div>
        </div>
      </CollapsibleBody>
    </Card>
  );
}

// ─── Acciones option sets ─────────────────────────────────────────────────

const REACTION_OPTIONS = [
  { value: "0.5", label: "0.5 msg/s" },
  { value: "1", label: "1 msg/s" },
  { value: "3", label: "3 msg/s" }
] as const;

const COOLDOWN_OPTIONS = [
  { value: "30", label: "30 s" },
  { value: "45", label: "45 s" },
  { value: "60", label: "60 s" },
  { value: "120", label: "120 s" }
] as const;

const SPAM_OPTIONS = [
  { value: "5", label: "5 msgs/usuario en 30s" },
  { value: "10", label: "10 msgs/usuario en 30s" },
  { value: "15", label: "15 msgs/usuario en 30s" },
  { value: "20", label: "20 msgs/usuario en 30s" }
] as const;

const PRESET_OPTIONS: ReadonlyArray<{ value: StreamPresetLevel; label: string }> = STREAM_FIXTURE.presets.map(
  (preset) => ({ value: preset.level, label: preset.label })
);

// CTK-derived preset->value maps (opencohost/ui/stream_admin_ui.py
// _build_chat_live_tab): threshold presets are 0.5/1/3 msg/s, cooldown
// presets are 30/60/120s, in bajo/medio/alto order.
const REACTION_PRESET_VALUES: Record<StreamPresetLevel, string> = {
  bajo: REACTION_OPTIONS[0].value,
  medio: REACTION_OPTIONS[1].value,
  alto: REACTION_OPTIONS[2].value
};

const COOLDOWN_PRESET_VALUES: Record<StreamPresetLevel, string> = {
  bajo: "30",
  medio: "60",
  alto: "120"
};

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
  const [isOpen, toggle] = useCollapsible(true, "stream-acciones");
  const chatLiveQuery = useStreamChatLiveQuery();
  const limitsMutation = useStreamLimitsMutation();

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
        <h2 className="text-sm font-bold text-foreground">Acciones</h2>
        {pending && <Badge tone="info">aplicando…</Badge>}
      </CollapsibleHeader>

      <CollapsibleBody isOpen={isOpen}>
        <div className="flex flex-col gap-3">
          {/* Deferred note — local-only filter_policy switch */}
          <div role="status" className="mb-3.5 rounded-md border border-warn-bd bg-warn-bg px-3 py-2.5">
            <p className="text-xs leading-relaxed text-muted-foreground">
              El contrato de entrada es un cambio local — el endpoint ya acepta{" "}
              <span className="mono text-warn">filter_policy</span>, pero falta decidir qué valor de preset le
              corresponde a este switch.
            </p>
          </div>

          <section aria-labelledby="stream-reactions-label" className="space-y-2.5 border-t border-border-soft pt-3.5">
            <span id="stream-reactions-label" className="text-[11px] font-semibold uppercase tracking-[0.09em] text-dim">
              Reacciones
            </span>
            <div className="space-y-2">
              <span id="stream-reaction-helper" className="text-xs text-muted-foreground">
                Reaccionar si el chat supera
              </span>
              <Select
                aria-label="Umbral de reacciones"
                aria-describedby="stream-reaction-helper"
                options={REACTION_OPTIONS}
                value={reactionThreshold}
                disabled={limitsMutation.isPending}
                onChange={(value) => {
                  setReactionThreshold(value);
                  limitsMutation.mutate({ threshold_per_second: Number(value) });
                }}
              />
            </div>
            <Segmented
              ariaLabel="Preset de reacciones"
              options={PRESET_OPTIONS}
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
              Cooldown
            </span>
            <div className="space-y-2">
              <span id="stream-cooldown-helper" className="text-xs text-muted-foreground">
                Esperar al menos, entre reacciones
              </span>
              <Select
                aria-label="Cooldown entre reacciones"
                aria-describedby="stream-cooldown-helper"
                options={COOLDOWN_OPTIONS}
                value={cooldown}
                disabled={limitsMutation.isPending}
                onChange={(value) => {
                  setCooldown(value);
                  limitsMutation.mutate({ cooldown_seconds: Number(value) });
                }}
              />
            </div>
            <Segmented
              ariaLabel="Preset de cooldown"
              options={PRESET_OPTIONS}
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
              Spam
            </span>
            <div className="space-y-2">
              <span id="stream-spam-helper" className="text-xs text-muted-foreground">
                Límite de mensajes repetidos
              </span>
              <Select
                aria-label="Límite de spam"
                aria-describedby="stream-spam-helper"
                options={SPAM_OPTIONS}
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
              Contrato de entrada
            </span>
            <div className="grid grid-cols-[1fr_auto] items-center gap-3">
              <span className="text-[13px] text-foreground">Input Contract (contexto real)</span>
              <Switch
                checked={inputContract}
                disabled
                onChange={() => {}}
                aria-label="Input Contract"
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
  const [isOpen, toggle] = useCollapsible(false, "stream-emision");

  return (
    <Card className="flex flex-col p-4">
      <CollapsibleHeader isOpen={isOpen} onToggle={toggle}>
        <h2 className="text-sm font-bold text-foreground w-full justify-between">Emisión (OAuth/metadata/moderación)</h2>
        <Badge tone="neutral">pendiente</Badge>
      </CollapsibleHeader>

      <CollapsibleBody isOpen={isOpen}>
        <p role="status" className="text-xs leading-relaxed text-muted-foreground">
          Conexión OAuth, metadata del stream y moderación existen en el CTK pero están pendientes de una decisión de
          producto del owner — todavía no hay nada interactivo acá.
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
  return (
    <>
      <Alert tone="info" title="Modo stream no disponible" role="status">
        La integración de chat en vivo (Twitch/YouTube) aún no está migrada desde la aplicación anterior. Esta
        sección estará inactiva hasta esa migración.
      </Alert>
      <ChatLiveCard />
      <AccionesCard />
      <DeferredStreamAdminNote />
    </>
  );
}
