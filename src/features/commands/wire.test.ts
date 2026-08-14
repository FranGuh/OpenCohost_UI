import { describe, expect, it } from "vitest";
import type { AgendaResponse } from "../../api/agenda.js";
import { ApiError, ConflictError, ValidationError } from "../../api/client.js";
import type { StreamChatLiveResponse } from "../../api/stream.js";
import { StreamConnectTimeoutError } from "../../api/stream.js";
import {
  COOLDOWN_WIRE,
  FILTER_POLICY,
  LENGTH_WIRE,
  PRIORITY_WIRE,
  REACCIONES_WIRE,
  SAFETY_WIRE,
  composeStreamUrl,
  describeConnect,
  describeMood,
  describeSessionAction,
  describeStreamLimits,
  errorCopy,
  isYoutubeChannelUrl,
  toAgendaSessionRequest,
  toAgendaTopicRequest,
  toCohostProfileRequest,
  toStreamLimits
} from "./wire.js";

const streamBase: StreamChatLiveResponse = {
  connected: false,
  platform: null,
  source_id: null,
  threshold_per_second: 1,
  cooldown_seconds: 45,
  max_messages_per_user: 10,
  filter_policy: "balanced",
  input_contract: false,
  stream_over_agenda: false,
  stream_ttl_seconds: 300,
  effective_stream_ttl_seconds: 300,
  adaptive_activation: false
};

describe("/acciones vocab tables (R22/R23/R25)", () => {
  it("REACCIONES_WIRE maps bajo/medio/alto → 1/3/5", () => {
    expect(REACCIONES_WIRE.bajo).toBe(1);
    expect(REACCIONES_WIRE.medio).toBe(3);
    expect(REACCIONES_WIRE.alto).toBe(5);
  });

  it("COOLDOWN_WIRE maps bajo/medio/alto → 20/45/90", () => {
    expect(COOLDOWN_WIRE.bajo).toBe(20);
    expect(COOLDOWN_WIRE.medio).toBe(45);
    expect(COOLDOWN_WIRE.alto).toBe(90);
  });

  it("FILTER_POLICY maps the 3 presets to themselves (wire value === UI value)", () => {
    expect(FILTER_POLICY.balanced).toBe("balanced");
    expect(FILTER_POLICY.twitch_relaxed).toBe("twitch_relaxed");
    expect(FILTER_POLICY.strict).toBe("strict");
  });
});

describe("toStreamLimits (R22-R25)", () => {
  it("builds the StreamLimitsRequest from UI values, casting spam to int", () => {
    expect(
      toStreamLimits({ reacciones: "alto", cooldown: "bajo", spam: "20", input_contract: "strict" })
    ).toEqual({
      threshold_per_second: 5,
      cooldown_seconds: 20,
      max_messages_per_user: 20,
      filter_policy: "strict"
    });
  });

  it("maps the step defaults to their canonical wire values", () => {
    expect(
      toStreamLimits({ reacciones: "medio", cooldown: "medio", spam: "10", input_contract: "balanced" })
    ).toEqual({
      threshold_per_second: 3,
      cooldown_seconds: 45,
      max_messages_per_user: 10,
      filter_policy: "balanced"
    });
  });
});

describe("describeStreamLimits (R26)", () => {
  it("connected → applied-immediately copy", () => {
    expect(describeStreamLimits({ ...streamBase, connected: true })).toMatch(/se aplicó al chat en vivo/i);
  });

  it("not connected → saved-as-defaults copy", () => {
    expect(describeStreamLimits({ ...streamBase, connected: false })).toMatch(/próxima vez que conectes/i);
  });
});

describe("/agenda vocab tables + request builder (R12-R14, R33-R35)", () => {
  it("PRIORITY_WIRE maps the closed UI vocab to wire priority (R33)", () => {
    expect(PRIORITY_WIRE.alta).toBe("alta");
    expect(PRIORITY_WIRE.normal).toBe("normal");
    expect(PRIORITY_WIRE.baja).toBe("baja");
  });

  it("LENGTH_WIRE maps corto→corta, normal→normal, profundo→expandida (R34)", () => {
    expect(LENGTH_WIRE.corto).toBe("corta");
    expect(LENGTH_WIRE.normal).toBe("normal");
    expect(LENGTH_WIRE.profundo).toBe("expandida");
  });

  it("toAgendaTopicRequest maps values, keeps etiquetas in entry order, omits an empty angle", () => {
    expect(
      toAgendaTopicRequest({ tema: "  tema x ", angulo: "", prioridad: "alta", largo: "profundo", etiquetas: ["a", "b"] })
    ).toEqual({
      title: "tema x",
      priority: "alta",
      response_length: "expandida",
      constraints: ["a", "b"]
    });
  });

  it("toAgendaTopicRequest trims a present angle and caps constraints at 24 (R35)", () => {
    const many = Array.from({ length: 30 }, (_, i) => `t${i}`);
    const req = toAgendaTopicRequest({ tema: "t", angulo: " enfoque ", prioridad: "baja", largo: "normal", etiquetas: many });
    expect(req.angle).toBe("enfoque");
    expect(req.constraints).toHaveLength(24);
  });
});

describe("/vivo url compose + connect ack (R20/R21)", () => {
  it("composeStreamUrl builds twitch.tv/<canal> from a bare channel", () => {
    expect(composeStreamUrl("twitch", "kira")).toBe("twitch.tv/kira");
  });

  it("composeStreamUrl passes a bare 11-char YouTube id through and builds a watch URL otherwise", () => {
    expect(composeStreamUrl("youtube", "dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
    expect(composeStreamUrl("youtube", "mychan")).toBe("youtube.com/watch?v=mychan");
  });

  it("composeStreamUrl passes a full URL through untouched", () => {
    expect(composeStreamUrl("twitch", "https://twitch.tv/kira")).toBe("https://twitch.tv/kira");
    expect(composeStreamUrl("youtube", "youtube.com/watch?v=abc")).toBe("youtube.com/watch?v=abc");
  });

  it("describeConnect acks a connected chat naming the platform (voseo)", () => {
    const ok = describeConnect({ ...streamBase, connected: true, platform: "twitch", source_id: "kira" });
    expect(ok).toMatch(/chat en vivo conectado/i);
    expect(ok).toMatch(/twitch/i);
  });

  it("isYoutubeChannelUrl flags @handle / channel / c / user URLs (which 422 as invalid_url)", () => {
    expect(isYoutubeChannelUrl("https://youtube.com/@kirastreams")).toBe(true);
    expect(isYoutubeChannelUrl("youtube.com/channel/UC12345")).toBe(true);
    expect(isYoutubeChannelUrl("https://www.youtube.com/c/kira")).toBe(true);
    expect(isYoutubeChannelUrl("youtube.com/user/kira")).toBe(true);
  });

  it("isYoutubeChannelUrl passes a real watch/live video URL (and non-YouTube input) through", () => {
    expect(isYoutubeChannelUrl("https://www.youtube.com/watch?v=dQw4w9WgXcQ")).toBe(false);
    expect(isYoutubeChannelUrl("youtube.com/live/dQw4w9WgXcQ")).toBe(false);
    expect(isYoutubeChannelUrl("twitch.tv/kira")).toBe(false);
    expect(isYoutubeChannelUrl("dQw4w9WgXcQ")).toBe(false);
  });
});

describe("/perfil vocab + request builders (R16/R17/R19)", () => {
  it("SAFETY_WIRE maps live_safe→live_safe and estandar→monologue, never raw estandar (R19)", () => {
    expect(SAFETY_WIRE.live_safe).toBe("live_safe");
    expect(SAFETY_WIRE.estandar).toBe("monologue");
    expect(SAFETY_WIRE.estandar).not.toBe("estandar");
  });

  it("toCohostProfileRequest builds a trimmed {name, style} (R16)", () => {
    expect(toCohostProfileRequest({ nombre: " Kira dry ", estilo: " seca " })).toEqual({ name: "Kira dry", style: "seca" });
  });

  it("toAgendaSessionRequest casts turnos to int and maps safety_mode/rhythm (R17/R19)", () => {
    expect(toAgendaSessionRequest({ turnos: "8", modo: "estandar", ritmo: "dinamico" })).toEqual({
      max_turns_per_topic: 8,
      safety_mode: "monologue",
      rhythm: "dinamico"
    });
  });
});

describe("describeSessionAction (R28)", () => {
  it("reports empty_queue / guardrails refusals honestly, never a success claim", () => {
    expect(describeSessionAction("enable", { applied: false, reason: "empty_queue" } as AgendaResponse)).toMatch(
      /cola está vacía/i
    );
    expect(describeSessionAction("enable", { applied: false, reason: "guardrails_missing" } as AgendaResponse)).toMatch(
      /salvaguardas/i
    );
  });

  it("success copy reflects the dispatched action", () => {
    expect(describeSessionAction("soft_stop", {} as AgendaResponse)).toMatch(/pausad/i);
    expect(describeSessionAction("enable", {} as AgendaResponse)).toMatch(/activad/i);
    expect(describeSessionAction("emergency_stop", {} as AgendaResponse)).toMatch(/emergencia/i);
  });
});

describe("describeMood (R30)", () => {
  it("names the active mood on a normal hit", () => {
    expect(describeMood({ active_mood: "hype", tracks: [], suggested_track_id: null })).toMatch(/hype/i);
  });

  it("tells the operator when the selection fell back to the normal/any pool", () => {
    expect(describeMood({ active_mood: "hype", tracks: [], suggested_track_id: null, fallback: true })).toMatch(
      /pool normal\/general/i
    );
  });
});

describe("errorCopy (D5/F4 — never interpolate raw backend text)", () => {
  it("ValidationError with a KNOWN 422 code → localized copy, not the raw code", () => {
    const copy = errorCopy(new ValidationError("invalid_filter_policy"));
    expect(copy).not.toContain("invalid_filter_policy");
    expect(copy).toMatch(/contrato de entrada/i);
  });

  it("ValidationError with an UNKNOWN 422 detail → generic fallback, never the raw text", () => {
    const copy = errorCopy(new ValidationError("tema inválido"));
    expect(copy).not.toContain("tema inválido");
    expect(copy).toMatch(/probá de nuevo/i);
  });

  it("ConflictError → busy copy", () => {
    expect(errorCopy(new ConflictError("busy"))).toMatch(/en curso/i);
  });

  it("ApiError 503 → localized service-unavailable copy, not the raw status/detail", () => {
    const copy = errorCopy(new ApiError("cohost_write_failed", 503));
    expect(copy).not.toContain("cohost_write_failed");
    expect(copy).toMatch(/no está disponible/i);
  });

  it("unsupported_platform (422) → localized platform copy, not the raw code", () => {
    const copy = errorCopy(new ValidationError("unsupported_platform"));
    expect(copy).not.toContain("unsupported_platform");
    expect(copy).toMatch(/plataforma/i);
  });

  it("chat_source_unavailable (503) → connector-specific copy, not the raw code", () => {
    const copy = errorCopy(new ApiError("chat_source_unavailable", 503));
    expect(copy).not.toContain("chat_source_unavailable");
    expect(copy).toMatch(/conector de chat/i);
  });

  it("youtube_channel_url (client fast-fail) → asks for the live VIDEO link, not the raw code", () => {
    const copy = errorCopy(new ValidationError("youtube_channel_url"));
    expect(copy).not.toContain("youtube_channel_url");
    expect(copy).toMatch(/video en vivo/i);
  });

  it("StreamConnectTimeoutError → 'no conectó, verificá que esté EN VIVO' copy", () => {
    const copy = errorCopy(new StreamConnectTimeoutError());
    expect(copy).toMatch(/no conect/i);
    expect(copy).toMatch(/en vivo/i);
  });

  it("generic ApiError (other status) → status-tagged retry copy", () => {
    expect(errorCopy(new ApiError("boom", 500))).toMatch(/500/);
  });

  it("unknown/network error → generic retry copy", () => {
    expect(errorCopy(new Error("offline"))).toMatch(/probá de nuevo/i);
  });
});
