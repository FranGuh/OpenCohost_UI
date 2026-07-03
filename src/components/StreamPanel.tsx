import { useState } from "react";
import type { FormEvent } from "react";
import { Card } from "./ui/Card.js";
import { Badge } from "./ui/Badge.js";
import type { BadgeTone } from "./ui/Badge.js";
import { Button } from "./ui/Button.js";
import { Select } from "./ui/Select.js";
import { Segmented } from "./ui/Segmented.js";
import { Switch } from "./ui/Switch.js";
import { useMockCommand } from "../api/mock/useMockCommand.js";
import { STREAM_FIXTURE, type StreamPresetLevel } from "../api/mock/fixtures.js";

// No /api/stream/* endpoint exists yet — the CTK original lives in
// opencohost/ui/stream_admin_ui.py's 'acciones' subtab (Chat Live tab),
// wired to smart_agg.set_activity_limits / set_spam_limits /
// set_filter_policy and sanitize_live_url for the connect URL. This ships
// as a functional mock against STREAM_FIXTURE: connect/disconnect is local
// state (accepted != applied, same contract as useMockCommand elsewhere),
// and every control that mutates local-only data carries a role="status"
// disclosure. Proposed swap: GET /api/stream/chat-live, POST
// /api/stream/chat-live/connect, PUT /api/stream/chat-live/limits.
//
// RF4 (OAuth connect, stream metadata, moderation) is a flagged USER-ASSIST
// product decision (STREAM_ADMIN_ENABLED=False in the CTK) and is
// deliberately NOT built here — see DeferredStreamAdminNote below.

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

function ChatLiveCard() {
  const [url, setUrl] = useState(STREAM_FIXTURE.url);
  const [connectionState, setConnectionState] = useState<StreamConnectionState>(
    STREAM_FIXTURE.connected ? "conectado" : "desconectado"
  );
  const [error, setError] = useState<string | null>(null);
  const connectCommand = useMockCommand<string>();
  const badge = CONNECTION_BADGE[connectionState];

  async function handleConnect(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = url.trim();
    if (!isValidStreamUrl(trimmed)) {
      setError("Ingresá una URL válida de YouTube o Twitch (ej: https://twitch.tv/tu_canal).");
      return;
    }
    setError(null);
    setConnectionState("conectando");
    await connectCommand.run(trimmed);
    setConnectionState("conectado");
  }

  function handleDisconnect() {
    setConnectionState("desconectado");
  }

  return (
    <Card className="flex flex-col p-4">
      <div className="flex items-center justify-between gap-3 border-b border-border-soft pb-3">
        <h2 className="text-sm font-bold text-foreground">Chat en vivo</h2>
        <Badge tone={badge.tone}>{badge.label}</Badge>
      </div>

      <div className="flex flex-col gap-3.5 pt-3.5">
        <p role="status" className="text-xs leading-relaxed text-muted-foreground">
          Conectar es un mock local — no existe todavía el endpoint{" "}
          <span className="mono">POST /api/stream/chat-live/connect</span> en el backend.
        </p>

        <section aria-labelledby="stream-url-label" className="space-y-2">
          <span id="stream-url-label" className="text-[11px] font-semibold uppercase tracking-[0.09em] text-dim">
            Conexión
          </span>
          <form onSubmit={(event) => void handleConnect(event)} className="grid grid-cols-[1fr_auto] items-center gap-3">
            <input
              type="text"
              aria-label="URL del directo"
              value={url}
              disabled={connectCommand.pending || connectionState === "conectado"}
              onChange={(event) => setUrl(event.target.value)}
              placeholder="https://twitch.tv/tu_canal o https://youtube.com/watch?v=..."
              className="h-11 rounded-md border border-border bg-background px-3 text-sm text-foreground placeholder:text-dim focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-60"
            />
            <Button
              type="submit"
              variant="primary"
              className="bg-[image:var(--spectrum)]"
              disabled={connectCommand.pending || connectionState === "conectado"}
            >
              Conectar
            </Button>
          </form>
          {error && (
            <p role="alert" className="text-xs text-danger">
              {error}
            </p>
          )}
        </section>

        <div className="grid grid-cols-[1fr_auto] items-center gap-3">
          <span className="text-[13px] text-foreground">Desconectar del chat en vivo</span>
          <Button type="button" variant="outline" disabled={connectionState !== "conectado"} onClick={handleDisconnect}>
            Desconectar
          </Button>
        </div>
      </div>
    </Card>
  );
}

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

function AccionesCard() {
  const [reactionThreshold, setReactionThreshold] = useState(STREAM_FIXTURE.reaction_threshold);
  const [cooldown, setCooldown] = useState(STREAM_FIXTURE.cooldown);
  const [spamLimit, setSpamLimit] = useState(STREAM_FIXTURE.spam_limit);
  const [inputContract, setInputContract] = useState(STREAM_FIXTURE.input_contract);

  const reactionPreset = presetForValue(reactionThreshold, REACTION_PRESET_VALUES);
  const cooldownPreset = presetForValue(cooldown, COOLDOWN_PRESET_VALUES);

  const reactionCommand = useMockCommand<string>();
  const cooldownCommand = useMockCommand<string>();
  const spamCommand = useMockCommand<string>();
  const contractCommand = useMockCommand<boolean>();

  const pending = reactionCommand.pending || cooldownCommand.pending || spamCommand.pending || contractCommand.pending;

  return (
    <Card className="flex flex-col p-4">
      <div className="flex items-center justify-between gap-3 border-b border-border-soft pb-3">
        <h2 className="text-sm font-bold text-foreground">Acciones</h2>
        {pending && <Badge tone="info">aplicando…</Badge>}
      </div>

      <div className="flex flex-col gap-3.5 pt-3.5">
        <p role="status" className="text-xs leading-relaxed text-muted-foreground">
          Reacciones, cooldown, spam y contrato de entrada son cambios locales — no existe todavía{" "}
          <span className="mono">PUT /api/stream/chat-live/limits</span> en el backend.
        </p>

        <section aria-labelledby="stream-reactions-label" className="space-y-2">
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
              value={reactionThreshold}
              disabled={reactionCommand.pending}
              onChange={(event) => {
                setReactionThreshold(event.target.value);
                void reactionCommand.run(event.target.value);
              }}
            >
              {REACTION_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
          </div>
          <Segmented
            ariaLabel="Preset de reacciones"
            options={PRESET_OPTIONS}
            value={reactionPreset}
            disabled={reactionCommand.pending}
            onChange={(level) => {
              const value = REACTION_PRESET_VALUES[level];
              setReactionThreshold(value);
              void reactionCommand.run(value);
            }}
          />
        </section>

        <section aria-labelledby="stream-cooldown-label" className="space-y-2">
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
              value={cooldown}
              disabled={cooldownCommand.pending}
              onChange={(event) => {
                setCooldown(event.target.value);
                void cooldownCommand.run(event.target.value);
              }}
            >
              {COOLDOWN_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
          </div>
          <Segmented
            ariaLabel="Preset de cooldown"
            options={PRESET_OPTIONS}
            value={cooldownPreset}
            disabled={cooldownCommand.pending}
            onChange={(level) => {
              const value = COOLDOWN_PRESET_VALUES[level];
              setCooldown(value);
              void cooldownCommand.run(value);
            }}
          />
        </section>

        <section aria-labelledby="stream-spam-label" className="space-y-2">
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
              value={spamLimit}
              disabled={spamCommand.pending}
              onChange={(event) => {
                setSpamLimit(event.target.value);
                void spamCommand.run(event.target.value);
              }}
            >
              {SPAM_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
          </div>
        </section>

        <section aria-labelledby="stream-input-contract-label" className="space-y-2">
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
              disabled={contractCommand.pending}
              onChange={(checked) => {
                setInputContract(checked);
                void contractCommand.run(checked);
              }}
              aria-label="Input Contract"
            />
          </div>
        </section>
      </div>
    </Card>
  );
}

/** RF4 (OAuth connect, stream metadata, moderation) is flagged off in the
 * CTK (STREAM_ADMIN_ENABLED=False) pending an owner product decision — this
 * is a single honest deferred note, nothing interactive. */
function DeferredStreamAdminNote() {
  return (
    <Card className="flex flex-col p-4">
      <div className="flex items-center justify-between gap-3 border-b border-border-soft pb-3">
        <h2 className="text-sm font-bold text-foreground">Emisión (OAuth/metadata/moderación)</h2>
        <Badge tone="neutral">pendiente</Badge>
      </div>
      <p role="status" className="pt-3.5 text-xs leading-relaxed text-muted-foreground">
        Conexión OAuth, metadata del stream y moderación existen en el CTK pero están pendientes de una decisión de
        producto del owner — todavía no hay nada interactivo acá.
      </p>
    </Card>
  );
}

/**
 * Stream panel — RF3 "Chat en vivo" only. CTK parity:
 * opencohost/ui/stream_admin_ui.py's 'acciones' subtab, functional mock
 * (no /api/stream/* endpoint yet — see the mock-command contract note at
 * the top of this file). RF4 (OAuth/metadata/moderación) is deliberately
 * out of scope, see DeferredStreamAdminNote.
 */
export function StreamPanel() {
  return (
    <>
      <ChatLiveCard />
      <AccionesCard />
      <DeferredStreamAdminNote />
    </>
  );
}
