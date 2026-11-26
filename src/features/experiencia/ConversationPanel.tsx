import { memo, useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { subscribeAcceptedCompanionTurns } from "../desktop-companion/operatorTurnChannel.js";
import type {
  ChangeEvent,
  ClipboardEvent as ReactClipboardEvent,
  FormEvent,
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent
} from "react";
import {
  Calendar,
  Check,
  ChevronDown,
  CircleCheck,
  CircleDashed,
  Copy,
  Cpu,
  ExternalLink,
  Eye,
  EyeOff,
  Info,
  Mic,
  MicOff,
  Monitor,
  Music,
  OctagonAlert,
  Radio,
  SlidersHorizontal,
  Smartphone,
  TriangleAlert,
  UserRound,
  Volume2,
  X,
  type LucideIcon
} from "lucide-react";
import { Alert } from "../../ui/Alert.js";
import { COMMAND_PALETTE_LISTBOX_ID, CommandPalettePopover, ComposerCommandPanel } from "../commands/ComposerCommandPanel.js";
import { Textarea } from "../../ui/Textarea.js";
import { KiraFace } from "../../ui/KiraFace.js";
import { Markdown } from "../../ui/Markdown.js";
import { Switch } from "../../ui/Switch.js";
import { Tab, TabList, TabPanel, Tabs } from "../../ui/Tabs.js";
import { matchCommands } from "../commands/registry.js";
import { LogsPanel } from "./LogsPanel.js";
import { SpeechPlaybackBar } from "./SpeechPlaybackBar.js";
import { VisionLookControl } from "./VisionLookControl.js";
import { VisionThumbnails } from "./VisionThumbnails.js";
import { VisionInlineThumbnails } from "./VisionInlineThumbnails.js";
import { attachVisionBadges, type VisionBadge } from "./visionBadge.js";
import { VisionSeen } from "./VisionSeen.js";
import { ImageSendStatus, SentImages, type ImageSendState } from "./SentImage.js";
import { chatImageErrorKey } from "./chatImageError.js";
import { createPreviewUrl } from "./imagePreview.js";
import { usePreviewUrlGc } from "./usePreviewUrlGc.js";
import { useVisionReadyNotice } from "./useVisionReadyNotice.js";
import { ChatImageError, type ChatTurnImage, type WebSource } from "../../api/client.js";
import { SourceChips } from "./SourceChips.js";
import { useLookNow, useVisionQuery, useVisionUpdate, visionComposerState, visionMaxImages, visionReadiness, visionReasonKey } from "../../api/vision.js";
import { useVisionOffRequestStore, useVisionResultStore } from "../../store/visionStore.js";
import { executeVisionCommand, isComposerCommandPrefix, parseVisionCommand } from "../../lib/visionCommand.js";
import { KIRA_TURN_ATTR, useKiraSelection } from "./useKiraSelection.js";
import { segmentReply } from "./segmentReply.js";
import { StreamChatPanel } from "./StreamChatPanel.js";
import { useLogsPref } from "../../store/useLogsPref.js";
import { useAgendaEvents } from "../../api/agenda.js";
import { useLastReply, useLastReplyByTurn, useSendChatTurn } from "../../api/chat.js";
import { useRemoteMessages } from "../../api/remote.js";
import { useLiveTranscript } from "../../api/liveTranscript.js";
import { usePttHold, usePttStateQuery, type PttUiState } from "../../api/ptt.js";
import { emitAppEvent } from "../../lib/appEvents.js";
import { insertDictation, type ComposerSelection } from "./dictation.js";
import { SPEECH_TEXT_MAX_LENGTH, useReadAloud, useSpeechState, type SpeechErrorKind, type SpeechSayMode } from "../../api/speech.js";
import { useStatusQuery } from "../../api/status.js";
import { useMemoriaCaptureMutation, useMemoriaCaptureQuery } from "../../api/memoria.js";
import { usePersonalizationQuery } from "../../api/personalization.js";
import { useLlmReadiness } from "../shared/useLlmReadiness.js";
import { LlmReadinessCard } from "../shared/LlmReadinessCard.js";
import { Button } from "../../ui/Button.js";
import { errorCopy } from "./pttCopy.js";
import { cn } from "../../lib/cn.js";
import { useT } from "../../i18n/t.js";
import { selectEvents, useEventStore, type AppEventSource, type AppEventTone } from "../../store/eventStore.js";
import { selectStreamChatLatestSeq, useStreamChatStore } from "../../store/streamChatStore.js";
import { useSpeechProgressStore } from "../../store/speechProgressStore.js";
import { useChatStatsStore } from "../../store/chatStatsStore.js";

/** Owner layout correction (2026-07-18): ONE unified strip
 * `Todo | Chat | Comandos | Alertas | Stream` (+ `Logs` when the pref is on).
 * Todo/Chat/Alertas are feed filters over the single timeline; Comandos swaps
 * to the inline command palette; Stream swaps to the read-only viewer-chat
 * mirror (RF3); Logs swaps to the engine event feed. */
type TabValue = "todo" | "chat" | "comandos" | "alertas" | "stream" | "logs";

/** Fixed feed-tab ids so the shared timeline panel's `aria-labelledby` can name
 * the active filter tab (Todo/Chat/Alertas all control one panel). */
const FEED_TAB_ID: Record<"todo" | "chat" | "alertas", string> = {
  todo: "conv-tab-todo",
  chat: "conv-tab-chat",
  alertas: "conv-tab-alertas"
};

function tabClass(active: boolean): string {
  return cn(
    "h-8 rounded-md px-3 text-[13px] font-semibold text-muted-foreground transition-colors duration-fast ease-io",
    "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
    active && "bg-[color:var(--accent-soft)] text-primary"
  );
}

// Auto-scroll follow distance: an append while the operator sits within this
// many px of the bottom follows the stream; further up, we surface the
// jump-to-recent button instead of yanking (Item 3).
const NEAR_BOTTOM_PX = 80;

/** Session-transcript ring-buffer cap. Mirrors eventStore's EVENT_CAP and
 * agenda's AGENDA_EVENT_CAP — the transcript was the last of the three streams
 * feeding this timeline with no bound at all. Every turn is re-mapped,
 * re-sorted and re-filtered on each render, and renders are driven by four
 * independent polls, so an unbounded transcript is a per-render cost multiplier
 * that grows for the whole stream. Eviction is oldest-first; a live timeline
 * wants the recent end. 200 turns is several hours of real conversation.
 * ponytail: plain slice, no windowing/virtualization, no new dependency. */
export const TRANSCRIPT_CAP = 200;

/** Same one-liner idiom as eventStore.ts's append. */
function capTurns(turns: Turn[]): Turn[] {
  return turns.length > TRANSCRIPT_CAP ? turns.slice(turns.length - TRANSCRIPT_CAP) : turns;
}

/** Id of the transient "pensando" row. It is a SENTINEL, not content: appended
 * after the sorted list while a reply is in flight and gone once the reply
 * lands. Named so the auto-scroll effect below can skip it when it asks "what
 * is the last REAL row" — that window is tens of seconds on a heavy local model
 * (dispatch.py documents OLLAMA_CHAT_TIMEOUT as 180s), and while a sentinel owns
 * the bottom-row identity every arrival looks like "nothing new at the end". */
const KIRA_THINKING_ID = "kira-thinking";

/** Fixed id for the composer's text field, so focus restore can name it instead
 * of grabbing the first `input` under `composerRef` — the command surfaces
 * mount in there too, and they have inputs of their own. Same convention as the
 * timeline's `conversation-panel` id. */
const COMPOSER_INPUT_ID = "composer-input";

/** Unit 4.2 (runtime_findings_batch_20260731, D3b): "esperó Xs en cola" /
 * "esperó 1 min 12 s en cola" — ms -> a short honest label. Only called for
 * a real (>0) wait; a 0ms/instant reply skips the note entirely (see the
 * render site) rather than printing a noisy "esperó 0 s en cola". */
function formatQueueWaitLabel(ms: number): string {
  const totalSeconds = Math.round(ms / 1000);
  if (totalSeconds < 60) return `${totalSeconds} s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return seconds === 0 ? `${minutes} min` : `${minutes} min ${seconds} s`;
}

/** Unit 4.2 (F12 closure): the ANSWERING provider, disclosed as a short human
 * label — "local" is Kira's own machine (Ollama); anything else is a cloud
 * provider id, shown as-is (no hardcoded provider-name table, mirrors the
 * backend's own "do not hardcode a provider code table" rule, 1.1). */
function providerLabel(provider: string): string {
  return provider === "local" ? "Ollama local" : provider;
}

const VOICE_PENDING_ID = "voice-pending";

type TurnKind = "chat" | "alert";

interface Turn {
  id: string;
  kind: TurnKind;
  /** Marks a turn as Kira-authored (the transient "thinking" indicator or a
   * real accumulated reply) so ConversationTurn can distinguish it from an
   * operator bubble without relying on a magic id string. */
  role?: "operator" | "kira";
  /** Present for operator-submitted turns and accumulated Kira replies. */
  text?: string;
  /** Sort key interleaving the independent chat/agenda/app-event streams. The
   * REAL event time wherever a server clock exists — Kira's reply carries
   * `ts` on GET /api/chat/last-reply, server app-events carry theirs through
   * src/api/events.ts, and a voice turn borrows the engine's own `ptt.*` echo.
   * Client arrival time only where nothing better is available (agenda diffs,
   * operator composer sends — which ARE local actions, so arrival IS the truth). */
  ts?: number;
  /** Voice echo still waiting for the backend to confirm Kira received it
   * (`ptt.flushed`). Rendered dimmed/italic; removed if the hold is discarded. */
  pending?: boolean;
  /** True when this Kira reply came from an autonomous agenda turn
   * (last-reply `source` startsWith "kira-agenda") rather than a reply to
   * operator/viewer chat — drives a distinct KIRA · AGENDA label. */
  fromAgenda?: boolean;
  /** V1.9: outcome of the look that preceded this Kira reply (metadata only —
   * never an image or description). Attached in `visibleTurns`. */
  visionBadge?: VisionBadge;
  /** Operator turn sent with pasted images (up to the backend limit, T7). Owner
   * decision 2026-11-10: the images ARE shown in the conversation, as thumbnails
   * from `imagePreviewUrls`. Those URLs live in this panel's memory for the
   * session only (revoked when the turn leaves the transcript or the panel
   * unmounts); the bytes are never put in history, storage or any request but the
   * image-turn POST. Without preview URLs the bubble shows a neutral "image" chip. */
  hasImage?: boolean;
  imagePreviewUrls?: string[];
  /** In-flight or failed image send; absent once the engine accepted the turn. */
  imageSend?: ImageSendState;
  /** Marks an operator turn that arrived by voice (PTT hold echoed from
   * LiveAudio's transcript WS) rather than the composer — drives the
   * "Vos · voz" label above the bubble. */
  source?: "voice" | "remote";
  /** Unit 4.2 (runtime_findings_batch_20260731, D3b/F12): how long this reply
   * sat queued before the engine dequeued it (GET /api/chat/last-reply
   * `queue_wait_ms`), and which provider actually answered. Undefined/null
   * for any turn with no submitted_under_provider tag (agenda, accumulated,
   * or the transient "pensando" sentinel) — never a fabricated value. */
  queueWaitMs?: number | null;
  answeredByProvider?: string | null;
  providerChanged?: boolean | null;
  /** D3b receipt: overrides the generic "Kira está pensando…" copy on the
   * transient thinking row while the engine is busy with other work — direct
   * chat never interrupts (D3), so this is honest about WHEN she'll answer. */
  pendingNote?: string;
  /** Agenda lifecycle / app-event copy (kind:"alert"). Rendered as a compact,
   * source-aware timeline row rather than a chat bubble. */
  event?: string;
  /** Event domain source (music, model, profile, agenda, etc.) driving the
   * row's icon and subtle accent. */
  eventSource?: AppEventSource;
  /** Tone the app-event carries (agenda events have none → neutral). */
  tone?: AppEventTone;
  /** Owner asked Kira to look while vision was off (`vision_off_request`):
   * rendered as an inline action row instead of an Alert line. */
  visionOff?: boolean;
  /** Sentence fragments for deterministic line-tracking while TTS is speaking. */
  fragments?: string[];
  /** Real sources of a web answer (last-reply `web_sources`), shown as chips under
   * the reply. In this panel's memory for the session only: never stored. */
  sources?: WebSource[];
}

/** Mirrors the backend contract (opencohost/api/chat_image.py). */
const IMAGE_MIME_TYPES: ReadonlyArray<ChatTurnImage["mime_type"]> = ["image/png", "image/jpeg", "image/webp"];
const IMAGE_MAX_BYTES = 8 * 1024 * 1024;

type AttachedImage = ChatTurnImage & { previewUrl: string; seq: number };

function matchesTab(tab: TabValue, kind: TurnKind): boolean {
  if (tab === "chat") return kind === "chat";
  if (tab === "alertas") return kind === "alert";
  return true; // "todo" (non-feed tabs hide the timeline anyway)
}

// ONE formatter for the module — same reason LogsPanel hoists TS_FORMAT
// (src/features/experiencia/LogsPanel.tsx): Date#toLocaleTimeString builds a
// fresh locale formatter on every call, and this one is paid per ROW on every
// parent render. Hour+minute+second: allows observing turn response latency directly in chat.
const TURN_TIME_FORMAT = new Intl.DateTimeFormat("es-AR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });

interface TurnTimeProps {
  ts?: number;
  className?: string;
}

/** Quiet per-row wall clock. Without it a five-minute-old backlogged event is
 * visually indistinguishable from a fresh one — which is how an out-of-order
 * feed hides. Metadata only: a time, never a payload value. */
function TurnTime({ ts, className = "" }: TurnTimeProps) {
  if (ts === undefined) return null;
  return (
    <time dateTime={new Date(ts).toISOString()} className={`mono shrink-0 text-[10px] font-normal tabular-nums text-dim ${className}`.trim()}>
      {TURN_TIME_FORMAT.format(ts)}
    </time>
  );
}

function KiraBadgeLabel({ fromAgenda = false, id }: { fromAgenda?: boolean; id?: string }) {
  const t = useT();
  return (
    <span id={id} className="mono inline-flex w-fit items-center gap-[6px] text-[11px] font-semibold tracking-[0.06em] text-[var(--kira-cyan)]">
      <KiraFace size={22} aria-hidden />
      {fromAgenda ? t("experiencia.conversationPanel.turn.agendaBadge") : "KIRA"}
    </span>
  );
}

interface ConversationTurnProps {
  turn: Turn;
  operatorName?: string;
  isSpeakingTurn?: boolean;
  /** True while this turn's reply is still being streamed by the backend. */
  isStreamingTurn?: boolean;
  autoFollow?: boolean;
  /** Queue the full turn text through the read-aloud endpoint. */
  onReadAloud?: (text: string, mode: SpeechSayMode) => void;
  /** Failed image turn: resend the same image and text, or drop the message. */
  onRetryImage?: (turnId: string) => void;
  onDiscardImage?: (turnId: string) => void;
}

/**
 * Renders nothing; fetches `last-reply?turn_id=N` while mounted and reports its
 * fragments. Mounted only while the spoken turn's feed fragments are missing or
 * stale, so the panel itself carries no idle query. A 404 reports nothing.
 */
function SpokenTurnFragmentsLoader({
  turnId,
  version,
  onLoaded
}: {
  turnId: number;
  version: number;
  onLoaded: (value: { turnId: number; fragments: string[] } | null) => void;
}) {
  const query = useLastReplyByTurn(turnId, true, version);
  const fragments = query.data?.fragments;
  useEffect(() => {
    onLoaded(fragments?.length ? { turnId, fragments } : null);
  }, [turnId, fragments, onLoaded]);
  return null;
}

interface KiraTurnContentProps {
  text: string;
  fragments?: string[];
  isSpeakingTurn: boolean;
  autoFollow?: boolean;
  /** Id of the reply's header: names the bubble group for screen readers. */
  labelledBy?: string;
}

interface DomWord {
  clean: string;
  node: Text;
  start: number;
  end: number;
}

const WORD_SPLIT_REGEX = /[\p{L}\p{N}]+/gu;

function findTextRange(root: HTMLElement, searchText: string): { range: Range; blockElement: HTMLElement | null } | null {
  if (!searchText) return null;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const textNodes: Text[] = [];
  let n: Text | null;
  while ((n = walker.nextNode() as Text | null)) {
    if (n.nodeValue && n.nodeValue.length > 0) {
      textNodes.push(n);
    }
  }
  if (textNodes.length === 0) return null;

  // 1. Fast path: exact raw substring match if present
  let fullText = "";
  const slices: { node: Text; start: number; end: number }[] = [];
  for (const tn of textNodes) {
    const val = tn.nodeValue || "";
    const start = fullText.length;
    fullText += val;
    slices.push({ node: tn, start, end: start + val.length });
  }

  const trimmed = searchText.trim();
  const directIdx = fullText.indexOf(trimmed);
  if (directIdx !== -1) {
    const targetStart = directIdx;
    const targetEnd = directIdx + trimmed.length;
    let startNode: Text | null = null;
    let startOffset = 0;
    let endNode: Text | null = null;
    let endOffset = 0;
    for (const s of slices) {
      if (!startNode && targetStart >= s.start && targetStart < s.end) {
        startNode = s.node;
        startOffset = targetStart - s.start;
      }
      if (targetEnd > s.start && targetEnd <= s.end) {
        endNode = s.node;
        endOffset = targetEnd - s.start;
        break;
      }
    }
    if (startNode && endNode) {
      try {
        const range = document.createRange();
        range.setStart(startNode, startOffset);
        range.setEnd(endNode, endOffset);
        const blockElement = (startNode.parentElement?.closest("p, li, h1, h2, h3, h4, h5, h6, pre, blockquote, tr") ??
          startNode.parentElement) as HTMLElement | null;
        return { range, blockElement };
      } catch {}
    }
  }

  // 2. Resilient word-level alignment: handles stripped quotation marks,
  // typography differences, markdown tags, and punctuation-evading splits.
  const domWords: DomWord[] = [];
  for (const node of textNodes) {
    const text = node.nodeValue || "";
    WORD_SPLIT_REGEX.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = WORD_SPLIT_REGEX.exec(text)) !== null) {
      domWords.push({
        clean: m[0].toLowerCase(),
        node,
        start: m.index,
        end: m.index + m[0].length
      });
    }
  }

  const searchWords: string[] = [];
  WORD_SPLIT_REGEX.lastIndex = 0;
  let sm: RegExpExecArray | null;
  while ((sm = WORD_SPLIT_REGEX.exec(searchText)) !== null) {
    searchWords.push(sm[0].toLowerCase());
  }

  if (domWords.length === 0 || searchWords.length === 0) return null;

  // Contiguous run of DOM words equal to ALL the fragment's words. No partial
  // or "first long word" fallback: a wrong highlight is worse than none.
  let bestStart = -1;
  for (let i = 0; i + searchWords.length <= domWords.length; i++) {
    let k = 0;
    while (k < searchWords.length && domWords[i + k].clean === searchWords[k]) k++;
    if (k === searchWords.length) {
      bestStart = i;
      break;
    }
  }

  if (bestStart === -1) return null;

  const startWord = domWords[bestStart];
  const matchedSpan = searchWords.length;
  const endWord = domWords[bestStart + matchedSpan - 1];

  try {
    const range = document.createRange();
    range.setStart(startWord.node, startWord.start);
    range.setEnd(endWord.node, endWord.end);
    const blockElement = (startWord.node.parentElement?.closest("p, li, h1, h2, h3, h4, h5, h6, pre, blockquote, tr") ??
      startWord.node.parentElement) as HTMLElement | null;
    return { range, blockElement };
  } catch {
    return null;
  }
}

function KiraTurnContent({ text, fragments, isSpeakingTurn, autoFollow = true, labelledBy }: KiraTurnContentProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const prevBlockRef = useRef<HTMLElement | null>(null);
  const speaking = useSpeechProgressStore((s) => (isSpeakingTurn ? s.speaking : false));
  const currentIdx = useSpeechProgressStore((s) => (isSpeakingTurn ? s.currentIdx : null));
  // Exact fragment the backend reports as playing now; preferred over fragments[currentIdx].
  const spokenFragment = useSpeechProgressStore((s) => (isSpeakingTurn ? s.fragment : null));
  const jobEpoch = useSpeechProgressStore((s) => s.jobEpoch);

  useEffect(() => {
    // Cleanup previous active block styling
    if (prevBlockRef.current) {
      prevBlockRef.current.classList.remove("oc-reading-active");
      prevBlockRef.current = null;
    }

    // The backend's spoken fragment is the source of truth; the feed's
    // fragments[currentIdx] is only the fallback when it is absent.
    const idxFragment =
      currentIdx !== null && currentIdx >= 0 && fragments && currentIdx < fragments.length
        ? fragments[currentIdx]
        : null;
    const currentFrag = spokenFragment || idxFragment;
    const shouldHighlight = isSpeakingTurn && speaking && Boolean(currentFrag);

    if (!shouldHighlight || !containerRef.current) {
      if (typeof CSS !== "undefined" && "highlights" in CSS) {
        CSS.highlights.delete("kira-speech-highlight");
      }
      return;
    }

    const match = findTextRange(containerRef.current, currentFrag as string);

    if (match) {
      const { range, blockElement } = match;

      // 1. CSS Custom Highlight API for exact sentence range
      if (typeof Highlight !== "undefined" && typeof CSS !== "undefined" && "highlights" in CSS) {
        try {
          const highlight = new Highlight(range);
          CSS.highlights.set("kira-speech-highlight", highlight);
        } catch {}
      }

      // 2. Subtle accent on the active paragraph/block
      if (blockElement) {
        blockElement.classList.add("oc-reading-active");
        prevBlockRef.current = blockElement;

        // 3. Auto-follow scroll ("check de seguimiento para evitar scrolear")
        if (autoFollow) {
          blockElement.scrollIntoView?.({ behavior: "smooth", block: "nearest" });
        }
      }
    }

    return () => {
      if (typeof CSS !== "undefined" && "highlights" in CSS) {
        CSS.highlights.delete("kira-speech-highlight");
      }
      if (prevBlockRef.current) {
        prevBlockRef.current.classList.remove("oc-reading-active");
        prevBlockRef.current = null;
      }
    };
  }, [isSpeakingTurn, speaking, fragments, spokenFragment, currentIdx, jobEpoch, autoFollow]);

  // A few calm bubbles instead of one wall of text (segmentReply.ts). Closed
  // segments never change while the reply streams, so index keys keep their
  // DOM (and Markdown memo) stable and only the last bubble grows. One
  // container still wraps the whole reply: the speech highlight and the
  // in-turn selection both work across bubbles, and screen readers get one
  // group named by the reply header.
  const segments = useMemo(() => {
    const parts = segmentReply(text);
    return parts.length > 0 ? parts : [text];
  }, [text]);
  const last = segments.length - 1;
  return (
    <div
      ref={containerRef}
      {...{ [KIRA_TURN_ATTR]: "" }}
      role="group"
      aria-labelledby={labelledBy}
      data-segment-count={segments.length}
      className="oc-turn-content flex w-full min-w-0 flex-col gap-1"
    >
      {segments.map((segment, index) => (
        <div
          key={index}
          data-reply-segment=""
          className={cn(
            "w-full min-w-0 rounded-md rounded-tl-sm border border-border bg-surface-2 px-3 py-2 text-foreground",
            index < last && "rounded-bl-sm",
            index > 0 && "oc-reply-segment-enter"
          )}
        >
          <Markdown content={segment} />
        </div>
      ))}
    </div>
  );
}

/** Inline "vision is off" action (owner asked Kira to look while it was off).
 * Only the most recent request gets the live button; older rows are static. */
function VisionOffRow({ turn }: { turn: Turn }) {
  const t = useT();
  const { data } = useVisionQuery();
  const update = useVisionUpdate();
  const isLatest = useVisionOffRequestStore((s) => s.requests[s.requests.length - 1]?.id === turn.id);
  const readiness = visionReadiness(data);
  let status: string;
  let button = false;
  if (readiness === "starting" || readiness === "warming") status = t("experiencia.vision.off.starting");
  else if (readiness === "ready") status = t("experiencia.vision.off.ready");
  else if (readiness === "failed") status = t("experiencia.vision.off.failed");
  else if (!isLatest) status = t("experiencia.vision.off.earlier");
  else {
    status = t("experiencia.vision.off.message");
    button = true;
  }
  return (
    <div className="flex flex-row items-center justify-between gap-2">
      <div role="status" data-vision-off-row="" data-tone="warn" className="oc-alert oc-alert-row min-w-0 flex-1">
        <TriangleAlert className="oc-alert-icon" size={16} aria-hidden="true" />
        <span className="oc-alert-row-msg" aria-live="polite">
          {status}
        </span>
        {button && (
          <Button variant="ghost" className="oc-alert-row-action h-7 px-4" disabled={update.isPending} onClick={() => update.mutate({ enabled: true })}>
            {t("experiencia.vision.off.enable")}
          </Button>
        )}
        <TurnTime ts={turn.ts} className="oc-alert-row-time" />
      </div>
    </div>
  );
}

function VisionTurnBadge({ badge }: { badge: VisionBadge }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const ok = badge.outcome === "ok";
  const seconds = badge.describeMs != null ? (badge.describeMs / 1000).toFixed(1) : null;
  const multi = badge.framesSent != null && badge.framesSent > 1;
  const clip = badge.mode === "clip";
  const label = ok
    ? clip
      ? badge.framesSent != null && badge.framesSent > 1
        ? t("experiencia.vision.badge.clip.frames", { frames: badge.framesSent })
        : t("experiencia.vision.badge.clip")
      : seconds === null
      ? t("experiencia.vision.badge.ok.noTime")
      : multi
        ? t("experiencia.vision.badge.ok.frames", { frames: badge.framesSent as number, seconds })
        : t("experiencia.vision.badge.ok", { seconds })
    : t("experiencia.vision.badge.failed", { reason: t(visionReasonKey(badge.outcome)) });
  const { data: visionData } = useVisionQuery();
  const inline = visionData?.show_thumbnails === true;
  const hasLook = ok && Boolean(badge.lookId);
  // With "show thumbnails" on, frames render inline; the toggle is the fallback.
  const canExpand = hasLook && !inline;
  const toggleLabel = t(open ? "experiencia.vision.thumbs.hide" : "experiencia.vision.thumbs.show");
  return (
    <div className="flex flex-col items-start gap-1">
      <p className={cn("mono inline-flex w-fit items-center gap-1 text-[10px]", ok ? "text-dim" : "text-warn")}>
        <Eye size={10} aria-hidden="true" />
        {label}
        {canExpand && (
          <button
            type="button"
            aria-label={toggleLabel}
            aria-expanded={open}
            title={toggleLabel}
            onClick={() => setOpen((v) => !v)}
            className="rounded p-0.5 hover:text-foreground"
          >
            <ChevronDown size={10} aria-hidden="true" className={cn("transition-transform", open && "rotate-180")} />
          </button>
        )}
      </p>
      {hasLook && (inline || open) && <VisionSeen lookId={badge.lookId as string} />}
      {canExpand && open && <VisionThumbnails lookId={badge.lookId as string} mode={badge.mode} framesSent={badge.framesSent} />}
      {hasLook && inline && <VisionInlineThumbnails lookId={badge.lookId as string} mode={badge.mode} framesSent={badge.framesSent} />}
    </div>
  );
}

const EVENT_SOURCE_STYLE: Record<AppEventSource, { icon: LucideIcon; iconClass: string }> = {
  music: { icon: Music, iconClass: "text-violet-400/80" },
  model: { icon: Cpu, iconClass: "text-sky-400/80" },
  "llm-provider": { icon: Cpu, iconClass: "text-sky-400/80" },
  profile: { icon: UserRound, iconClass: "text-emerald-400/80" },
  agenda: { icon: Calendar, iconClass: "text-amber-400/80" },
  "kira-agenda": { icon: Calendar, iconClass: "text-amber-400/80" },
  stream: { icon: Radio, iconClass: "text-pink-400/80" },
  ptt: { icon: Mic, iconClass: "text-cyan-400/80" },
  vision: { icon: Eye, iconClass: "text-sky-400/80" },
  obs: { icon: Monitor, iconClass: "text-muted-foreground" },
  settings: { icon: SlidersHorizontal, iconClass: "text-muted-foreground" },
  motor: { icon: Info, iconClass: "text-info/80" }
};

const PRIVATE_TOOLTIP_DWELL_MS = 350;
const PRIVATE_TOOLTIP_FADE_MS = 200;

/**
 * Private mode toggle with a styled hover/focus explanation card matching
 * Sidebar's profile preview card (dwell on hover, immediate on keyboard focus,
 * smooth fade-out, Escape to dismiss, no unstyled native `title`).
 */
function PrivateModeControl({
  checked,
  available,
  error,
  onToggle
}: {
  checked: boolean;
  available: boolean;
  error: boolean;
  onToggle: (next: boolean) => void;
}) {
  const t = useT();
  const tooltipId = useId();
  const anchorRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const dwellRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fadeRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [tip, setTip] = useState<{ left: number; top: number; closing: boolean } | null>(null);

  const clearTimers = useCallback(() => {
    if (dwellRef.current !== null) {
      clearTimeout(dwellRef.current);
      dwellRef.current = null;
    }
    if (fadeRef.current !== null) {
      clearTimeout(fadeRef.current);
      fadeRef.current = null;
    }
  }, []);

  const computePos = useCallback(() => {
    const rect = anchorRef.current?.getBoundingClientRect();
    const cardWidth = 288;
    const rawLeft = rect ? rect.right - cardWidth : 12;
    const maxLeft = Math.max(8, window.innerWidth - cardWidth - 8);
    const left = Math.min(maxLeft, Math.max(8, rawLeft));
    const top = rect ? rect.bottom + 8 : 48;
    return { left, top };
  }, []);

  const openNow = useCallback(() => {
    clearTimers();
    const { left, top } = computePos();
    setTip({ left, top, closing: false });
  }, [clearTimers, computePos]);

  const openAfterDwell = useCallback(() => {
    clearTimers();
    dwellRef.current = setTimeout(() => {
      dwellRef.current = null;
      const { left, top } = computePos();
      setTip({ left, top, closing: false });
    }, PRIVATE_TOOLTIP_DWELL_MS);
  }, [clearTimers, computePos]);

  const hide = useCallback(() => {
    if (dwellRef.current !== null) {
      clearTimeout(dwellRef.current);
      dwellRef.current = null;
    }
    setTip((prev) => (prev ? { ...prev, closing: true } : null));
    if (fadeRef.current !== null) clearTimeout(fadeRef.current);
    fadeRef.current = setTimeout(() => {
      fadeRef.current = null;
      setTip(null);
    }, PRIVATE_TOOLTIP_FADE_MS);
  }, []);

  useEffect(() => {
    if (!tip) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") hide();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [tip, hide]);

  useEffect(() => clearTimers, [clearTimers]);

  const stateLabel = !available
    ? t("experiencia.conversationPanel.privateMode.tooltip.state.unavailable")
    : checked
      ? t("experiencia.conversationPanel.privateMode.tooltip.state.on")
      : t("experiencia.conversationPanel.privateMode.tooltip.state.off");

  return (
    <div
      ref={anchorRef}
      className="relative inline-flex items-center gap-2"
      onMouseEnter={openAfterDwell}
      onMouseLeave={hide}
      onFocus={openNow}
      onBlur={(event) => {
        if (!anchorRef.current?.contains(event.relatedTarget as Node | null)) hide();
      }}
      aria-describedby={tip ? tooltipId : undefined}
    >
      <span
        onClick={() => available && onToggle(!checked)}
        className={cn(
          "select-none text-[11.5px] transition-colors",
          available ? "cursor-pointer hover:text-foreground" : "cursor-not-allowed opacity-60",
          checked ? "font-semibold text-warn" : "font-medium text-muted-foreground"
        )}
      >
        {t("experiencia.conversationPanel.privateMode")}
      </span>
      {error && (
        <span role="alert" className="text-[11px] font-semibold text-warn">
          {t("experiencia.conversationPanel.privateMode.error")}
        </span>
      )}
      <Switch
        checked={checked}
        disabled={!available}
        onChange={onToggle}
        aria-label={t("experiencia.conversationPanel.privateMode")}
      />
      {tip && (
        <div
          id={tooltipId}
          ref={cardRef}
          role="tooltip"
          style={{
            position: "fixed",
            left: tip.left,
            top: tip.top,
            backgroundColor: "var(--surface-2)",
            backdropFilter: "var(--surface-blur)",
            WebkitBackdropFilter: "var(--surface-blur)"
          }}
          className={cn(
            "pointer-events-none z-50 w-72 rounded-md border border-border-soft bg-surface-2 p-3 text-left shadow-panel backdrop-blur-md transition-opacity duration-base ease-io",
            tip.closing ? "opacity-0" : "animate-rise-in opacity-100"
          )}
        >
          <div className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
              <EyeOff size={13} aria-hidden="true" className={checked ? "text-warn" : "text-muted-foreground"} />
              {t("experiencia.conversationPanel.privateMode")}
            </span>
            <span
              className={cn(
                "rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                !available
                  ? "bg-surface-2 text-dim border border-border-soft"
                  : checked
                    ? "bg-warn-bg text-warn border border-warn-bd"
                    : "bg-background/60 text-muted-foreground border border-border-soft"
              )}
            >
              {stateLabel}
            </span>
          </div>

          {!available ? (
            <p className="mt-2 text-[11.5px] leading-relaxed text-muted-foreground">
              {t("experiencia.conversationPanel.privateMode.unavailable")}
            </p>
          ) : (
            <>
              <p className="mt-1.5 text-[11.5px] leading-snug text-muted-foreground">
                {t("experiencia.conversationPanel.privateMode.tooltip.lead")}
              </p>
              <p className="mt-2.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-dim">
                {t("experiencia.conversationPanel.privateMode.tooltip.disablesHeading")}
              </p>
              <ul className="mt-1 space-y-1 pl-3.5 text-[11px] leading-snug text-muted-foreground list-disc">
                <li>{t("experiencia.conversationPanel.privateMode.tooltip.disables.memories")}</li>
                <li>{t("experiencia.conversationPanel.privateMode.tooltip.disables.episodes")}</li>
                <li>{t("experiencia.conversationPanel.privateMode.tooltip.disables.session")}</li>
              </ul>
              <p className="mt-2.5 border-t border-border-soft/70 pt-2 text-[10.5px] leading-snug text-dim">
                {t("experiencia.conversationPanel.privateMode.tooltip.keepsNote")}
              </p>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function FeedEventRow({
  label,
  tone,
  source,
  ts
}: {
  label: string;
  tone: AppEventTone;
  source?: AppEventSource;
  ts?: number;
}) {
  let Icon: LucideIcon = CircleDashed;
  let iconClass = "text-muted-foreground/75";

  if (tone === "danger") {
    Icon = OctagonAlert;
    iconClass = "text-danger";
  } else if (tone === "warn") {
    Icon = TriangleAlert;
    iconClass = "text-warn";
  } else if (source === "motor") {
    Icon = tone === "ok" ? CircleCheck : Info;
    iconClass = tone === "ok" ? "text-ok/80" : "text-info/80";
  } else if (source) {
    Icon = EVENT_SOURCE_STYLE[source].icon;
    iconClass = EVENT_SOURCE_STYLE[source].iconClass;
  }

  const surfaceClass =
    tone === "danger"
      ? "border-danger-bd/60 border-l-2 border-l-danger bg-danger-bg/35 text-foreground"
      : tone === "warn"
        ? "border-warn-bd/60 border-l-2 border-l-warn bg-warn-bg/30 text-foreground"
        : "border-border-soft/50 bg-surface-2/35 text-muted-foreground";

  return (
    <div
      role="status"
      data-tone={tone}
      data-event-source={source}
      className={cn(
        "flex w-full items-center gap-2 rounded-md border px-2.5 py-1.5 text-xs leading-snug animate-rise-in",
        surfaceClass
      )}
    >
      <Icon className={cn("shrink-0", iconClass)} size={13} aria-hidden="true" />
      <span className="min-w-0 flex-1">{label}</span>
      <TurnTime ts={ts} className="ml-auto shrink-0 tabular-nums text-right opacity-70" />
    </div>
  );
}

function ConversationTurnImpl({
  turn,
  operatorName,
  isSpeakingTurn = false,
  isStreamingTurn = false,
  autoFollow = true,
  onReadAloud,
  onRetryImage,
  onDiscardImage
}: ConversationTurnProps) {
  const t = useT();
  // Read aloud is blocked while this reply streams or is being spoken, and for
  // text over the backend cap (the endpoint would answer 422).
  const turnSpeaking = useSpeechProgressStore((s) => (isSpeakingTurn ? s.speaking : false));
  const readAloudTooLong = (turn.text?.length ?? 0) > SPEECH_TEXT_MAX_LENGTH;
  const readAloudDisabled = isStreamingTurn || turnSpeaking || readAloudTooLong;
  const readAloudLabel = t("experiencia.readaloud.action");
  const effectiveOperatorName = operatorName || t("experiencia.conversationPanel.turn.anonymous");
  // T7: copies the RAW reply text (turn.text, the LLM's actual markdown
  // source), never the rendered DOM — a code block's copy control (inside
  // Markdown.tsx) handles per-block copies separately.
  const [copied, setCopied] = useState(false);
  const headerId = useId();
  function handleCopyMessage() {
    const text = turn.text ?? "";
    if (!text) return;
    void navigator.clipboard?.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }
  if (turn.role === "kira" && turn.text === undefined) {
    return (
      <div className="flex flex-col gap-1.5">
        <KiraBadgeLabel />
        <p className="w-full animate-pulse rounded-md rounded-tl-sm border border-border bg-surface-2 px-3 py-2 text-sm italic text-dim">
          {turn.pendingNote ?? t("experiencia.conversationPanel.turn.pending")}
        </p>
      </div>
    );
  }

  if (turn.role === "kira") {
    // Unit 4.2 (D3b/F12): a subtle meta line — queue wait and/or the
    // answering provider — under the timestamp. Skipped entirely for an
    // untagged turn (agenda/accumulated) and for a genuinely instant (0ms)
    // reply, which would otherwise print a noisy "esperó 0 s en cola".
    const hasWaitNote = turn.queueWaitMs != null && turn.queueWaitMs > 0;
    const hasProviderNote = Boolean(turn.answeredByProvider);
    // Kira's reply is LLM markdown — render it formatted (bold, code, tables,
    // lists, links). min-w-0 + the bubble's max-w keep long code/tables scrolling
    // inside the bubble instead of widening the panel. A <div> (not <p>) because
    // markdown emits block elements (<pre>, <table>) that can't nest in a <p>.
    return (
      <div className="flex flex-col gap-1.5">
        <span className="flex items-center gap-2">
          <KiraBadgeLabel fromAgenda={turn.fromAgenda} id={headerId} />
          <TurnTime ts={turn.ts}/>
          {onReadAloud && (
            <button
              type="button"
              onClick={() => onReadAloud(turn.text ?? "", "queue")}
              disabled={readAloudDisabled}
              aria-label={readAloudLabel}
              title={readAloudTooLong ? t("experiencia.readaloud.action.tooLong") : readAloudLabel}
              className={cn(
                "ml-auto inline-flex items-center justify-center rounded-md border border-transparent p-1 text-muted-foreground transition-colors",
                "hover:border-border-soft hover:bg-surface-2 hover:text-foreground disabled:opacity-40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              )}
            >
              <Volume2 size={12} aria-hidden="true" />
            </button>
          )}
          <button
            type="button"
            onClick={handleCopyMessage}
            aria-label={copied ? t("experiencia.conversationPanel.turn.copied") : t("experiencia.conversationPanel.turn.copy")}
            title={copied ? t("experiencia.conversationPanel.turn.copied") : t("experiencia.conversationPanel.turn.copy")}
            className={cn(
              "inline-flex items-center justify-center rounded-md border border-transparent p-1 text-muted-foreground transition-colors",
              !onReadAloud && "ml-auto",
              "hover:border-border-soft hover:bg-surface-2 hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
              copied && "text-ok"
            )}
          >
            {copied ? <Check size={12} aria-hidden="true" /> : <Copy size={12} aria-hidden="true" />}
          </button>
        </span>
        <KiraTurnContent
          text={turn.text ?? ""}
          fragments={turn.fragments}
          isSpeakingTurn={isSpeakingTurn}
          autoFollow={autoFollow}
          labelledBy={headerId}
        />
        {turn.visionBadge && <VisionTurnBadge badge={turn.visionBadge} />}
        <SourceChips sources={turn.sources} />
        {(hasWaitNote || hasProviderNote) && (
          <p className="mono text-[10px] text-dim">
            {hasWaitNote &&
              t("experiencia.conversationPanel.turn.queueWait", {
                duration: formatQueueWaitLabel(turn.queueWaitMs as number)
              })}
            {hasWaitNote && hasProviderNote && " · "}
            {hasProviderNote && providerLabel(turn.answeredByProvider as string)}
            {turn.providerChanged ? t("experiencia.conversationPanel.turn.providerChanged") : ""}
          </p>
        )}
      </div>
    );
  }

  if (turn.text !== undefined) {
    return (
      <div className="flex flex-col items-end gap-1">
        <span className="flex items-center gap-2">
          {turn.source === "voice" ? (
            <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-dim">
              <Mic size={11} aria-hidden="true" />
              {t("experiencia.conversationPanel.turn.operatorVoice", { name: effectiveOperatorName })}
            </span>
          ) : turn.source === "remote" ? (
            <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-dim">
              <Smartphone size={11} aria-hidden="true" />
              {t("experiencia.conversationPanel.turn.operatorRemote", { name: effectiveOperatorName })}
            </span>
          ) : (
            <span className="text-[11px] font-semibold text-dim">{effectiveOperatorName}</span>
          )}
          <TurnTime ts={turn.ts} />
        </span>
        {/* text-[15px] + leading-relaxed: same legibility bump as Kira's
            Markdown bubble; break-words so a pasted long token can't widen it. */}
        <div
          data-pending={turn.pending ? "true" : undefined}
          className={`w-full break-words rounded-md rounded-tr-sm border border-ok-bd bg-ok-bg px-3 py-2 text-[15px] leading-relaxed text-foreground${turn.pending ? " italic opacity-60" : ""}`}
        >
          {turn.text !== "" && <Markdown content={turn.text} breaks />}
          {turn.hasImage && <SentImages previewUrls={turn.imagePreviewUrls} />}
          {turn.imageSend && (
            <ImageSendStatus
              state={turn.imageSend}
              onRetry={() => onRetryImage?.(turn.id)}
              onDiscard={() => onDiscardImage?.(turn.id)}
            />
          )}
        </div>
      </div>
    );
  }

  // Agenda lifecycle / operator-action event line. Full-width Alert (not a
  // centered meta chip) so it reads as a timeline entry and follows the
  // operator's chosen alert style (sereno/marcado/contorno), same as every
  // other Alert. role="status" (not "alert") so these historical lines announce
  // on arrival without INTERRUPTING the screen reader the way a live send-error
  // does. Tone reuses whatever the event carries (agenda events → neutral). The
  // label text is owned upstream (appEvents.ts / agenda.ts) and is not edited
  // here. rise-in entry is provided by the .oc-alert base rule itself.
  // The stamp sits OUTSIDE the Alert, not inside its body: `oc-alert-body` is a
  // single <p>, so a nested <time> would fold into that element's text content
  // and every exact-match assertion on an event label would start matching
  // "Modelo → qwen3:8b 14:05" instead.
  if (turn.visionOff) {
    return <VisionOffRow turn={turn} />;
  }

  if (turn.event !== undefined) {
    return (
      <FeedEventRow
        label={turn.event}
        tone={turn.tone ?? "neutral"}
        source={turn.eventSource}
        ts={turn.ts}
      />
    );
  }

  return null;
}

/** Memoized for the same reason Markdown is (src/ui/Markdown.tsx —
 * the in-repo pattern): every row was re-rendered on every parent render, and
 * the parent re-renders on four polls plus every keystroke. `turn` objects are
 * stable across renders now that visibleTurns is memoized, so this actually
 * bails out instead of just adding a comparison. */
const ConversationTurn = memo(ConversationTurnImpl);

const READ_ALOUD_ERROR_KEY = {
  guard: "experiencia.readaloud.error.guard",
  unavailable: "experiencia.readaloud.error.unavailable",
  invalid: "experiencia.readaloud.error.invalid",
  generic: "experiencia.readaloud.error.generic"
} as const;

interface ReadAloudControlsProps {
  state: Parameters<typeof SpeechPlaybackBar>[0]["state"];
  selectedText: string | null;
  busy: boolean;
  errorKind: SpeechErrorKind | null;
  onSay: (text: string, mode: SpeechSayMode) => void;
  onStop: () => void;
  onPause: () => void;
  onResume: () => void;
}

/** Selection actions + playback bar + error line, stacked above the composer.
 * Inline (not floating) so it needs no pointer geometry and stays keyboard reachable. */
function ReadAloudControls({ state, selectedText, busy, errorKind, onSay, onStop, onPause, onResume }: ReadAloudControlsProps) {
  const t = useT();
  const tooLong = (selectedText?.length ?? 0) > SPEECH_TEXT_MAX_LENGTH;
  const btn = cn(
    "inline-flex h-7 items-center rounded-md border border-border-soft px-2 text-xs font-semibold text-foreground transition-colors",
    "hover:bg-surface-2 disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
  );
  // Keep the text selection alive while the button takes the click.
  const keepSelection = (e: ReactMouseEvent) => e.preventDefault();
  return (
    <>
      {selectedText && (
        <div
          role="group"
          aria-label={t("experiencia.readaloud.selection.group")}
          className="mx-3 mb-2 flex items-center gap-2"
        >
          <button
            type="button"
            className={btn}
            disabled={busy || tooLong}
            title={tooLong ? t("experiencia.readaloud.selection.tooLong") : undefined}
            onMouseDown={keepSelection}
            onClick={() => onSay(selectedText, "queue")}
          >
            {t("experiencia.readaloud.selection.queue")}
          </button>
          <button
            type="button"
            className={btn}
            disabled={busy || tooLong}
            title={tooLong ? t("experiencia.readaloud.selection.tooLong") : undefined}
            onMouseDown={keepSelection}
            onClick={() => onSay(selectedText, "now")}
          >
            {t("experiencia.readaloud.selection.now")}
          </button>
        </div>
      )}
      <SpeechPlaybackBar state={state} busy={busy} onStop={onStop} onPause={onPause} onResume={onResume} />
      {errorKind && (
        <div className="px-3 pb-2">
          <Alert tone="warn" role="status">
            {t(READ_ALOUD_ERROR_KEY[errorKind])}
          </Alert>
        </div>
      )}
    </>
  );
}

/** <aside> queue region — the real POST /api/chat/turn composer (useSendChatTurn)
 * plus Kira's accumulated last-reply turns and interleaved agenda/app events.
 * The operator's own message is appended locally as an ephemeral turn so it's
 * visible immediately; there's no server echo to reconcile against. */
export function ConversationPanel() {
  const t = useT();
  const { data: personalization } = usePersonalizationQuery();
  const rawNickname = personalization?.enabled !== false ? personalization?.nickname?.trim() : undefined;
  const operatorName = rawNickname || t("experiencia.conversationPanel.turn.anonymous");

  // ONE unified tab strip (owner layout correction 2026-07-18): todo/chat/alertas
  // are feed filters; comandos and logs swap the panel. Default: the Todo feed.
  const [activeTab, setActiveTab] = useState<TabValue>("todo");
  // Command launched from the emergent composer popover, opened in the Comandos
  // tab. Controlled here so re-launching the SAME command reopens it there.
  const [comandoId, setComandoId] = useState<string | null>(null);
  // R36 flagged assumption: this preference gates Logs-TAB VISIBILITY, not a
  // "jump to Logs" shortcut — owner sign-off pending, see spec.md R36.
  const { showLogs } = useLogsPref();
  // Unread indicator for the Logs tab (D10/R7): ephemeral, session-only.
  const [seenLogId, setSeenLogId] = useState<string | null>(null);
  // Unread indicator for the Stream tab (RF3), same D10/R7 contract as Logs
  // above but keyed off the newest message `seq` instead of an event id — the
  // store's poll runs even while this tab is hidden (StreamChatPanel is kept
  // mounted by Tabs, src/ui/Tabs.tsx), so the dot can light up from off-tab.
  const [seenStreamSeq, setSeenStreamSeq] = useState<number | null>(null);
  const [message, setMessage] = useState("");
  // Pasted image (route A): held in memory only until the turn is sent. The
  // backend has the vision model describe it; Kira only ever gets text.
  const [attachedImages, setAttachedImages] = useState<AttachedImage[]>([]);
  // Slots taken in the composer: attached images plus pastes still being read.
  // A ref, so two quick pastes see each other before React re-renders.
  const imageSlotsRef = useRef(0);
  const imageSeqRef = useRef(0);
  // The text and bytes of image turns that have not been accepted yet, so Retry
  // can resend exactly the same thing. Memory only; dropped on success/discard.
  const imageDraftsRef = useRef(new Map<string, { text: string; images: ChatTurnImage[] }>());
  const [imageHint, setImageHint] = useState<"visionOff" | "unsupported" | "tooLarge" | "tooMany" | "onlyOne" | null>(null);
  // V1.10: look commands (/mira, !mira, /look, !look) arm a look, then send the rest.
  const { data: visionData } = useVisionQuery();
  const composerVision = visionComposerState(visionData);
  useVisionReadyNotice(composerVision.phase);
  const lookNow = useLookNow();
  const visionResults = useVisionResultStore((s) => s.results);
  const visionOffRequests = useVisionOffRequestStore((s) => s.requests);
  const [visionCommandBlocked, setVisionCommandBlocked] = useState(false);
  // Composer command palette (mockup): a live, prefix-based detection — the
  // panel shows whenever the trimmed composer value starts with "/" or "!".
  const composerRef = useRef<HTMLDivElement>(null);
  // The command the launcher opened IN PLACE, above the composer (owner
  // correction 2026-08-11: "me gusta más tenerlo integrado con el input y chat
  // flotante, o sea se invoca ahí, no llevar a otra sección"). Distinct from
  // `comandoId`, which is the Comandos tab's own browsable selection — picking
  // a command from the launcher must not move the operator off the chat, and
  // must not disturb whatever that tab was showing.
  const [launcherCommandId, setLauncherCommandId] = useState<string | null>(null);
  const showCommandPanel = isComposerCommandPrefix(message);
  // F1: the popover only renders an actual `role="listbox"` when at least one
  // command matches (zero matches shows the "comando desconocido" status hint
  // instead, no listbox) — the input's combobox expanded/controls state must
  // follow that reality, not just the raw "/"|"!" prefix. Derived straight from
  // the same registry the popover itself filters through — no extra plumbing.
  // An open in-place command owns the space above the composer (both surfaces
  // render at `absolute inset-x-0 bottom-full`, so they would stack). The open
  // one wins: typing "/" again must not silently discard a half-filled Stepper.
  const launcherOpen = showCommandPanel && launcherCommandId === null;
  const commandListboxOpen = launcherOpen && matchCommands(message).length > 0;
  // F3: the composer input's aria-activedescendant follows the popover's
  // keyboard-highlighted option (combobox pattern).
  const [activeDescendant, setActiveDescendant] = useState<string | null>(null);
  const [autoFollow, setAutoFollow] = useState(() => {
    try {
      const saved = localStorage.getItem("oc-autofollow-reading");
      return saved !== null ? saved === "true" : true;
    } catch {
      return true;
    }
  });

  const handleToggleAutoFollow = useCallback((enabled: boolean) => {
    setAutoFollow(enabled);
    try {
      localStorage.setItem("oc-autofollow-reading", String(enabled));
    } catch {}
  }, []);

  // Backend truth seeds the switch; `privateOptimistic` only bridges the
  // in-flight toggle and is dropped once the mutation settles (the success
  // path refetches the live state first).
  const captureQuery = useMemoriaCaptureQuery();
  const [privateOptimistic, setPrivateOptimistic] = useState<boolean | null>(null);
  const [privateError, setPrivateError] = useState(false);
  const privateMode = privateOptimistic ?? captureQuery.data?.private ?? false;
  const privateAvailable = captureQuery.data?.available ?? true;
  const captureMutation = useMemoriaCaptureMutation();
  const handleTogglePrivateMode = useCallback(
    (next: boolean) => {
      if (!privateAvailable) return;
      setPrivateError(false);
      setPrivateOptimistic(next);
      captureMutation.mutate(next, {
        onError: () => setPrivateError(true),
        onSettled: () => setPrivateOptimistic(null)
      });
    },
    [captureMutation, privateAvailable]
  );

  // Session-local transcript: operator turns (appended on successful send)
  // interleaved with accumulated Kira replies (appended as new turn_ids land
  // on the last-reply poll). This is the fix for the "each new reply erases
  // the previous one" bug — the old implementation only ever kept ONE Kira
  // turn around, replacing it on every poll instead of accumulating.
  const [transcript, setTranscript] = useState<Turn[]>([]);
  // Preview URLs still referenced by the composer or the transcript; the rest
  // (a removed attachment, a discarded or capped-out turn, unmount) are revoked.
  const previewUrlsInUse = useMemo(() => {
    const urls = new Set<string>();
    for (const image of attachedImages) urls.add(image.previewUrl);
    for (const turn of transcript) for (const url of turn.imagePreviewUrls ?? []) urls.add(url);
    return urls;
  }, [attachedImages, transcript]);
  usePreviewUrlGc(previewUrlsInUse);
  const companionTurnIdsRef = useRef<Set<string>>(new Set());
  useEffect(() => subscribeAcceptedCompanionTurns((turn) => {
    if (companionTurnIdsRef.current.has(turn.id)) return;
    companionTurnIdsRef.current.add(turn.id);
    setTranscript((turns) => capTurns([
      ...turns,
      { id: `companion-${turn.id}`, kind: "chat", role: "operator", text: turn.text, ts: turn.ts }
    ]));
  }), []);
  // Messages typed on the paired phone (remote gateway). Operator-only feed, in
  // memory on the backend; each message lands once, ordered by its server
  // accept time so it sits above the Kira reply it caused.
  useRemoteMessages((items) => {
    setTranscript((turns) => {
      const known = new Set(turns.map((turn) => turn.id));
      const fresh: Turn[] = items
        .filter((item) => !known.has(`remote-${item.seq}`))
        .map((item) => ({
          id: `remote-${item.seq}`,
          kind: "chat",
          role: "operator",
          source: "remote",
          text: item.text,
          ts: item.accepted_at * 1000
        }));
      return fresh.length === 0 ? turns : capTurns([...turns, ...fresh]);
    });
  });
  const { readiness, canChat, isReady } = useLlmReadiness({ activePolling: true });
  const isEngineUnready = Boolean(readiness && readiness.can_chat === false);
  const [pendingMessage, setPendingMessage] = useState<{
    id: string;
    text: string;
    status: "WAITING_FOR_ENGINE" | "SENDING";
  } | null>(null);
  const [showRecoveryModal, setShowRecoveryModal] = useState(false);
  const { send, pending, isError, error, reset: resetSend } = useSendChatTurn();
  const lastReply = useLastReply();
  const speechState = useSpeechState();
  const readAloud = useReadAloud();
  const { text: selectedText, clear: clearSelection } = useKiraSelection();
  const feedTurnId = useSpeechProgressStore((s) => s.feedTurnId);
  const speechActive = useSpeechProgressStore((s) => s.speaking);
  const speechTotal = useSpeechProgressStore((s) => s.total);
  const spokenFragmentText = useSpeechProgressStore((s) => s.fragment);
  // Follow-reading: the spoken turn's fragments come from the feed when they
  // are present and current; otherwise (missing, or a different count than the
  // job reports, with no backend fragment text to match) fetch them by turn id.
  const spokenTurnId = feedTurnId != null ? `kira-reply-${feedTurnId}` : null;
  const spokenFeedTurn = spokenTurnId ? transcript.find((turn) => turn.id === spokenTurnId) : undefined;
  const feedFragmentsStale =
    !spokenFragmentText &&
    (!spokenFeedTurn?.fragments?.length || spokenFeedTurn.fragments.length !== speechTotal);
  const needsTurnFragments = speechActive && Boolean(spokenFeedTurn) && feedFragmentsStale;
  const [fetchedFragments, setFetchedFragments] = useState<{ turnId: number; fragments: string[] } | null>(null);
  const spokenFragments =
    feedTurnId != null && fetchedFragments?.turnId === feedTurnId ? fetchedFragments.fragments : undefined;
  // D3b receipt: while the engine is busy (speaking/processing — most often
  // an agenda block), a direct question does NOT interrupt (D3) — it answers
  // on the next turn boundary. Reused below to swap the generic "pensando"
  // copy for an honest "responderá después del bloque actual".
  const status = useStatusQuery();
  const kiraBusy = Boolean(status.data?.is_speaking || status.data?.is_processing);
  // Autonomous agenda lifecycle events (topic activated/changed/finished/
  // paused, turns spoken) diffed from the agenda poll — interleaved into the
  // stream below as alert meta chips, filtered by the Alertas tab.
  const agendaEvents = useAgendaEvents();
  // Operator-action metadata events (model/profile/music/obs/stream/ptt —
  // src/lib/appEvents.ts's whitelist is the only source of these labels)
  // interleaved into the stream the same way agenda events already are.
  const appEvents = useEventStore(selectEvents);
  // Logs unread dot (D10/R7): lit when the newest event is unseen and we're not
  // already looking at Logs; cleared once Logs is active AND has rendered.
  const latestLogId = appEvents.length > 0 ? appEvents[appEvents.length - 1].id : null;
  const unreadLogs = showLogs && latestLogId !== null && latestLogId !== seenLogId && activeTab !== "logs";
  // Stream unread dot (RF3): same shape as unreadLogs above, keyed off seq.
  // Subscribes to the SEQ, not to the message array: this panel is mounted in
  // every section, and the array's identity changes on every 1.5s ingest — so
  // reading the number off the array re-rendered the whole panel on every poll
  // during active chat, defeating the render gate added for exactly that.
  const latestStreamSeq = useStreamChatStore(selectStreamChatLatestSeq);
  const unreadStream = latestStreamSeq !== null && latestStreamSeq !== seenStreamSeq && activeTab !== "stream";
  // Tracks the operator bubble for the in-flight/retryable send intent, so a
  // retry after a failed send updates that SAME bubble instead of appending
  // a duplicate "Vos" turn. Cleared once the send succeeds.
  const pendingTurnIdRef = useRef<string | null>(null);
  // The highest Kira turn_id already appended to the transcript. Starts at 0
  // to match the backend's own "no reply yet" sentinel (ChatReplySink.last(),
  // opencohost/api/engine_host.py) — turn_id 0 with text: null must never
  // create a phantom entry, and re-polling the SAME turn_id must never
  // duplicate the entry that's already in the transcript.
  const lastRecordedTurnIdRef = useRef(0);
  // True from a successful send until a GENUINE new reply lands. Gating this
  // on a plain "baseline turn_id" breaks when useLastReply hasn't resolved
  // yet at submit time (baseline would be null, so pending clearing alone
  // would immediately read as "no new reply" and drop the indicator). So we
  // track "waiting" as its own flag and only capture the baseline turn_id
  // once useLastReply actually resolves — the first resolution just anchors
  // the baseline, only a LATER change away from it counts as the real reply.
  const [awaitingReply, setAwaitingReply] = useState(false);
  const [awaitingBaseline, setAwaitingBaseline] = useState<number | null>(null);
  // Snapshot event ids at submit time so historical cloud failures cannot
  // cancel a later request.
  const awaitingFailureEventIdsRef = useRef<Set<string>>(new Set());
  const currentTurnId = lastReply.data?.turn_id ?? null;

  // Composer mic — the SAME usePttHold hook PTTCard drives, relocated here as
  // a hold-to-talk affordance. Pointer + button-local key events ONLY: PTTCard
  // owns the window-level global gesture when mounted, so adding a second set
  // of window listeners here would double-start the single-slot session.
  const { state: pttState, error: pttError, start: pttStart, stop: pttStop } = usePttHold();
  // No proactive STT-availability signal exists (see §3b(iv) of the design
  // doc / PRIVACY note in ptt.ts): unavailability only surfaces as a 503 on
  // start. After the first stt_unreachable we degrade the mic (MicOff, dimmed)
  // until a later press succeeds.
  const [micDegraded, setMicDegraded] = useState(false);
  const [micGuidanceRequested, setMicGuidanceRequested] = useState(false);
  // Confirms the SEND (not the reply): shown for 4s on the flushing -> idle
  // transition. Kira's reply lands in the transcript via useLastReply anyway.
  const [voiceSent, setVoiceSent] = useState(false);
  const prevPttStateRef = useRef<PttUiState>(pttState);

  // PTT dictation (ptt-dictation-20261111). The backend decides per hold, at
  // release, whether the words become a turn or go to this composer; the mode
  // read here only decides how the "sent" confirmation is timed (see below).
  const dictationMode = usePttStateQuery().data?.dictation_mode ?? "send";
  const dictationModeRef = useRef(dictationMode);
  dictationModeRef.current = dictationMode;
  const [dictationNotice, setDictationNotice] = useState<"dictated" | "lost" | "incomplete" | null>(null);
  // Last composer selection, captured while it is still valid: on every
  // select/change and at blur (clicking the mic blurs the textarea). Null means
  // the composer never had focus, so a dictation is appended.
  const composerSelectionRef = useRef<ComposerSelection | null>(null);
  // Caret to restore once the dictated value has rendered.
  const pendingCaretRef = useRef<number | null>(null);
  const voiceSentTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function captureComposerSelection(event: { currentTarget: HTMLTextAreaElement }) {
    const el = event.currentTarget;
    composerSelectionRef.current = { start: el.selectionStart ?? el.value.length, end: el.selectionEnd ?? el.value.length };
  }

  function flashVoiceSent() {
    if (voiceSentTimerRef.current !== null) clearTimeout(voiceSentTimerRef.current);
    setVoiceSent(true);
    voiceSentTimerRef.current = setTimeout(() => {
      voiceSentTimerRef.current = null;
      setVoiceSent(false);
    }, 4000);
  }

  // Live dictation (ptt-live-dictation-20261125): for a hold the backend locked
  // to dictate, the words land in the composer as they arrive. The composer
  // value at the hold's start plus its selection are the fixed base; every
  // update recomputes from that base, so the live span is replaced, never
  // duplicated, and nothing outside the selection/caret is ever overwritten.
  const [liveDictating, setLiveDictating] = useState(false);
  const liveDictatingRef = useRef(false);
  liveDictatingRef.current = liveDictating;
  const liveBaseRef = useRef<{ value: string; selection: ComposerSelection | null } | null>(null);
  const messageRef = useRef("");
  messageRef.current = message;

  function handleLiveStart() {
    liveBaseRef.current = { value: messageRef.current, selection: composerSelectionRef.current };
    setVoiceSent(false);
    setDictationNotice(null);
    setLiveDictating(true);
  }

  function handleLive(text: string) {
    const base = liveBaseRef.current;
    if (!base) return;
    setMessage(insertDictation(base.value, text, base.selection).value);
  }

  function endLive() {
    liveBaseRef.current = null;
    setLiveDictating(false);
  }

  function handleLiveCancel() {
    const base = liveBaseRef.current;
    if (base) setMessage(base.value);
    endLive();
  }

  function handleDictationTimeout() {
    // The words are the owner's own: keep them, and say they may be incomplete.
    endLive();
    setDictationNotice("incomplete");
  }

  function handleDictated(text: string) {
    setVoiceSent(false);
    setDictationNotice("dictated");
    const base = liveBaseRef.current;
    if (base) {
      const next = insertDictation(base.value, text, base.selection);
      pendingCaretRef.current = next.caret;
      composerSelectionRef.current = { start: next.caret, end: next.caret };
      setMessage(next.value);
      endLive();
      return;
    }
    const selection = composerSelectionRef.current;
    setMessage((prev) => {
      const next = insertDictation(prev, text, selection);
      pendingCaretRef.current = next.caret;
      composerSelectionRef.current = { start: next.caret, end: next.caret };
      return next.value;
    });
  }

  function handleDictationLost() {
    endLive(); // a live span stays in the composer: those words are the owner's
    setVoiceSent(false);
    setDictationNotice("lost");
    emitAppEvent({ source: "ptt", action: "dictation_lost" });
  }

  // Transcript echo: while a hold is active (this composer's mic OR the
  // external F10 bridge — both surface on the polled /api/ptt/state), the
  // hook consumes LiveAudio's broadcast WS directly and resolves the spoken
  // text once the backend flushes. PRIVACY: the words arrive over LiveAudio's
  // own socket, never the OpenCohost HTTP API. Empty/failed echo -> the hook
  // never fires -> no turn, no alert spam.
  useLiveTranscript((text, pttStamp) => {
    // The spoken WORDS never cross the OpenCohost HTTP API (privacy design), so
    // there is no server timestamp for the transcript itself — and its arrival
    // time is the flushing->idle observation, minutes late when the window is
    // backgrounded. But the HOLD's lifecycle does cross: the engine emits
    // `ptt.started`/`ptt.stopped`, and src/api/events.ts carries their REAL
    // server ts into the event store. The hook resolves which of those readings
    // belongs to THIS hold (per-hold baseline, see useLiveTranscript) and hands
    // it over as `pttStamp`, or 0 when the hold produced none. A reading that
    // belongs to the hold was taken before the grace window that dispatches the
    // turn, so it is strictly before the reply's own server ts — that is what
    // keeps the bubble above the answer it caused. 0 means arrival time, which
    // is honest and sorts last; it never re-borrows another hold's reading.
    const now = Date.now();
    const ts = pttStamp > 0 ? Math.min(pttStamp, now) : now;
    setTranscript((turns) =>
      capTurns([...turns, { id: `voice-${crypto.randomUUID()}`, kind: "chat", role: "operator", source: "voice", text, ts }])
    );
    // In a dictation mode the release transition cannot tell a sent hold from
    // a dictated one, so the confirmation waits for the backend's verdict.
    if (dictationModeRef.current !== "send") flashVoiceSent();
  }, (pendingText) => {
    // Live words are only PENDING until the backend confirms the flush.
    setTranscript((turns) => {
      const without = turns.filter((turn) => turn.id !== VOICE_PENDING_ID);
      if (!pendingText) return without.length === turns.length ? turns : without;
      const prior = turns.find((turn) => turn.id === VOICE_PENDING_ID);
      return capTurns([
        ...without,
        { id: VOICE_PENDING_ID, kind: "chat", role: "operator", source: "voice", pending: true, text: pendingText, ts: prior?.ts ?? Date.now() }
      ]);
    });
  }, {
    onDictated: handleDictated,
    onDictationLost: handleDictationLost,
    onLiveStart: handleLiveStart,
    onLive: handleLive,
    onLiveCancel: handleLiveCancel,
    onDictationTimeout: handleDictationTimeout
  });

  // Keep the caret right after freshly dictated words.
  useLayoutEffect(() => {
    const caret = pendingCaretRef.current;
    if (caret === null) return;
    pendingCaretRef.current = null;
    const el = composerRef.current?.querySelector<HTMLTextAreaElement>(`#${COMPOSER_INPUT_ID}`);
    if (!el) return;
    el.focus();
    el.setSelectionRange(caret, caret);
  }, [message, liveDictating]);

  // The dictation notices fade like the "sent" confirmation (longer for the
  // lost one, which asks the owner to act).
  useEffect(() => {
    if (dictationNotice === null) return;
    const timer = setTimeout(() => setDictationNotice(null), dictationNotice === "dictated" ? 6000 : 10_000);
    return () => clearTimeout(timer);
  }, [dictationNotice]);

  useEffect(
    () => () => {
      if (voiceSentTimerRef.current !== null) clearTimeout(voiceSentTimerRef.current);
    },
    []
  );

  // Timeline scroll-follow + jump-to-recent (Item 3). scrollRef is the existing
  // overflow-auto tabpanel.
  const scrollRef = useRef<HTMLDivElement>(null);
  // Id of the last REAL row (see lastTurnId below). This ALONE tells a genuine
  // append-at-the-end apart from a middle backfill and from a plain re-render —
  // the row count it used to be paired with could answer neither at
  // TRANSCRIPT_CAP (every arrival evicts one, so the count freezes) nor when a
  // reply replaces the thinking row (2 -> 2 in one flush).
  const prevLastTurnIdRef = useRef<string | null>(null);
  const [showJump, setShowJump] = useState(false);
  // T6 fix (owner-observed: "seguir lectura" stops following right after the
  // owner sends a message): the append-decision effect below used to
  // re-measure scrollHeight/scrollTop AFTER React had already committed the
  // new turn to the DOM. Appending real content (the operator's own bubble,
  // then the "pensando" row) grows scrollHeight while scrollTop hasn't moved
  // yet — so a live re-measurement at that point almost always reads "far
  // from the bottom", even when the operator was sitting AT the bottom a
  // moment earlier, and the follow silently stops. This ref instead tracks
  // "was near the bottom" from the last GENUINE scroll event (never touched
  // by an append itself, since appending content doesn't fire a 'scroll'
  // event), so the append effect can consult the pre-append state.
  const nearBottomRef = useRef(true);

  useEffect(() => {
    if (!awaitingReply) return;
    if (awaitingBaseline === null) {
      if (currentTurnId !== null) setAwaitingBaseline(currentTurnId);
      return;
    }
    if (currentTurnId !== awaitingBaseline) {
      setAwaitingReply(false);
      setAwaitingBaseline(null);
    }
  }, [awaitingReply, awaitingBaseline, currentTurnId]);

  useEffect(() => {
    if (!awaitingReply) return;
    const terminalFailure = appEvents.some(
      (event) =>
        event.source === "motor" &&
        (event.action === "cloud_llm_error" ||
          event.action === "reasoning_budget_exhausted" ||
          event.action === "turn_dropped" ||
          event.action === "ollama_unavailable" ||
          event.action === "llm_timeout_recovered") &&
        !awaitingFailureEventIdsRef.current.has(event.id)
    );
    if (!terminalFailure) return;
    setAwaitingReply(false);
    setAwaitingBaseline(null);
  }, [appEvents, awaitingReply]);

  // Accumulates a new Kira transcript entry the moment a NEW turn_id with
  // real text lands on the poll. Dedup is strict: a turn_id already appended
  // (including the initial 0/null-text sentinel) is never appended again, so
  // repeated polls of the same reply are a no-op.
  useEffect(() => {
    const data = lastReply.data;
    if (!data || !data.text) return;
    if (data.turn_id <= 0) return;
    if (data.turn_id < lastRecordedTurnIdRef.current) {
      // The backend's turn_id counter resets to a low number on restart. A
      // turn_id lower than the highest one we've already recorded means the
      // reply we just polled is stale from the NEW process's perspective —
      // resync the ref without appending, so a genuinely new reply (which
      // will land with a higher turn_id relative to this new baseline)
      // appends normally instead of being skipped or duplicated.
      lastRecordedTurnIdRef.current = data.turn_id;
      return;
    }
    lastRecordedTurnIdRef.current = data.turn_id;
    useChatStatsStore.getState().recordTurn(
      status.data?.active_profile_id ?? undefined,
      status.data?.current_model ?? undefined,
      typeof data.queue_wait_ms === "number" ? data.queue_wait_ms : undefined
    );
    if (data.web_searched) {
      useChatStatsStore.getState().recordSearch();
    }
    // The backend ALREADY stamps this reply: ChatReplySink.record() stores
    // `ts: time.time()` (opencohost/api/engine_host.py), surfaced through
    // ChatLastReplyResponse (models.py) as LastReplyResponse.ts here. Arrival
    // time was throwing that away, so a reply polled late — backgrounded
    // window, or several polls catching up in one burst — sorted by WHEN THE
    // WEBVIEW NOTICED rather than when Kira spoke, above the turn that caused
    // it. Seconds -> ms; `null` (no reply yet / older backend) keeps arrival
    // time as the honest fallback.
    const ts = typeof data.ts === "number" ? data.ts * 1000 : Date.now();
    // tauri_stream_chat_20260812 follow-up: `origin === "chat"` means this
    // reply answered VIEWER chat, not operator/agenda — it belongs in the
    // Stream chat tab (streamChatStore's kiraReplies slice, interleaved with
    // the viewer messages it answers there), and must NOT also land in this
    // Chat-tab transcript — that's the whole point of the distinction.
    // Missing/null `origin` is the safe default and falls through to the
    // unchanged path below (direct/PTT/agenda/accumulated/older backend).
    if (data.origin === "chat") {
      useStreamChatStore.getState().addKiraReply({ turnId: data.turn_id, text: data.text, ts });
      return;
    }
    const id = `kira-reply-${data.turn_id}`;
    // R8/source (llm_engine.py): a reply whose source starts with
    // "kira-agenda" is an autonomous agenda turn, not a reply to operator/
    // viewer chat — tag it so ConversationTurn labels it distinctly.
    const fromAgenda = data.source?.startsWith("kira-agenda") ?? false;
    // Unit 4.2 (D3b/F12): carried straight from ChatLastReplyResponse — null
    // for any turn with no submitted_under_provider tag (agenda, accumulated,
    // or a reply recorded before this unit), never a fabricated value.
    const queueWaitMs = data.queue_wait_ms ?? null;
    const answeredByProvider = data.answered_by_provider ?? null;
    const providerChanged = data.provider_changed_while_queued ?? null;
    // Real sources of a web answer, built by the backend (chips under the reply).
    const sources = data.web_sources?.length ? data.web_sources : undefined;
    setTranscript((turns) => {
      const existingIdx = turns.findIndex((turn) => turn.id === id);
      if (existingIdx !== -1) {
        const existing = turns[existingIdx];
        // The final reply can add its sources after the streamed text landed.
        const sourcesChanged = (existing.sources?.length ?? 0) !== (sources?.length ?? 0);
        if (existing.text === data.text && existing.fragments?.length === data.fragments?.length && !sourcesChanged) {
          return turns;
        }
        const updated = [...turns];
        updated[existingIdx] = {
          ...existing,
          text: data.text as string,
          fragments: data.fragments ?? existing.fragments,
          sources: sources ?? existing.sources,
        };
        return updated;
      }
      return capTurns([
        ...turns,
        {
          id,
          kind: "chat",
          role: "kira",
          text: data.text as string,
          fromAgenda,
          ts,
          queueWaitMs,
          answeredByProvider,
          providerChanged,
          fragments: data.fragments ?? undefined,
          sources,
        }
      ]);
    });
  }, [lastReply.data]);

  // Mic degrades on the first stt_unreachable and un-degrades once a press
  // actually reaches "listening" again.
  useEffect(() => {
    if (pttError === "stt_unreachable") setMicDegraded(true);
  }, [pttError]);
  useEffect(() => {
    if (pttState === "listening") {
      setMicDegraded(false);
      setMicGuidanceRequested(false);
    }
  }, [pttState]);

  // Clear the Logs unread dot once the operator is viewing Logs and the newest
  // event has rendered (R7 clear-on-view, not clear-on-click).
  useEffect(() => {
    if (activeTab === "logs") setSeenLogId(latestLogId);
  }, [activeTab, latestLogId]);

  // Clear the Stream unread dot once the operator is viewing Stream and the
  // newest message has rendered (same R7 clear-on-view contract as Logs).
  useEffect(() => {
    if (activeTab === "stream") setSeenStreamSeq(latestStreamSeq);
  }, [activeTab, latestStreamSeq]);

  // If the pref is turned OFF while Logs is active, fall back to the Todo feed
  // so the strip never points at a tab that no longer exists.
  useEffect(() => {
    if (!showLogs && activeTab === "logs") setActiveTab("todo");
  }, [showLogs, activeTab]);

  // "Turno de voz enviado" confirmation: fire on the flushing -> idle
  // transition with no error, auto-clear after 4s.
  useEffect(() => {
    const prev = prevPttStateRef.current;
    prevPttStateRef.current = pttState;
    if (prev === "flushing" && pttState === "idle" && pttError === null && dictationModeRef.current === "send") {
      setVoiceSent(true);
      const timer = setTimeout(() => setVoiceSent(false), 4000);
      return () => clearTimeout(timer);
    }
  }, [pttState, pttError]);

  const isThinking = pending || awaitingReply;

  // Auto-resume buffered message when LLM engine becomes ready
  useEffect(() => {
    if (canChat && pendingMessage && pendingMessage.status === "WAITING_FOR_ENGINE") {
      setPendingMessage((prev) => (prev ? { ...prev, status: "SENDING" } : null));
      const text = pendingMessage.text;
      const turnId = pendingMessage.id;
      pendingTurnIdRef.current = turnId;
      setTranscript((turns) => {
        const existingIndex = turns.findIndex((turn) => turn.id === turnId);
        if (existingIndex === -1) return capTurns([...turns, { id: turnId, kind: "chat", role: "operator", text, ts: Date.now() }]);
        const next = [...turns];
        next[existingIndex] = { ...next[existingIndex], text };
        return next;
      });

      send(text)
        .then(() => {
          pendingTurnIdRef.current = null;
          awaitingFailureEventIdsRef.current = new Set(appEvents.map((event) => event.id));
          setAwaitingReply(true);
          setAwaitingBaseline(currentTurnId);
          setPendingMessage(null);
          setShowRecoveryModal(false);
        })
        .catch(() => {
          setPendingMessage(null);
        });
    }
  }, [canChat, pendingMessage, send, currentTurnId]);

  // Enter sends, Shift+Enter inserts a newline (the textarea default). Listens on
  // `window`, i.e. AFTER the command palette's document-level handler, so a
  // palette that took the key (it calls preventDefault) wins exactly as it did
  // with the single-line input. IME composition (isComposing / keyCode 229)
  // must never send: Enter there confirms a candidate.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const target = event.target;
      if (!(target instanceof HTMLTextAreaElement) || target.id !== COMPOSER_INPUT_ID) return;
      if (event.key !== "Enter" || event.shiftKey || event.defaultPrevented) return;
      if (event.isComposing || event.keyCode === 229) return;
      if (liveDictatingRef.current) return; // read-only while dictating: never send a half dictation
      event.preventDefault(); // no newline: this Enter is a send
      target.form?.requestSubmit();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  function handleMessageChange(event: ChangeEvent<HTMLTextAreaElement>) {
    setVisionCommandBlocked(false);
    setImageHint(null);
    setMessage(event.target.value);
    captureComposerSelection(event);
  }

  // Ctrl+V of an image. Plain-text paste (no image item) is left to the browser.
  function handlePaste(event: ReactClipboardEvent<HTMLTextAreaElement>) {
    const items = Array.from(event.clipboardData?.items ?? []).filter(
      (entry) => entry.kind === "file" && entry.type.startsWith("image/")
    );
    if (items.length === 0) return;
    event.preventDefault();
    if (!(visionData?.enabled && visionData.model)) {
      setImageHint("visionOff");
      return;
    }
    // Every image of the paste that fits is attached; nothing already attached is
    // ever replaced. A refused image says why (a type or size problem wins over
    // the "limit reached" notice).
    const max = visionMaxImages(visionData);
    let problem: "unsupported" | "tooLarge" | "tooMany" | null = null;
    for (const item of items) {
      const file = item.getAsFile();
      if (!file) continue;
      if (!IMAGE_MIME_TYPES.includes(file.type as ChatTurnImage["mime_type"])) {
        problem = problem ?? "unsupported";
        continue;
      }
      if (file.size > IMAGE_MAX_BYTES) {
        problem = problem ?? "tooLarge";
        continue;
      }
      if (imageSlotsRef.current >= max) {
        problem = problem ?? "tooMany";
        continue;
      }
      imageSlotsRef.current += 1;
      readPastedImage(file);
    }
    setImageHint(problem === "tooMany" ? (max === 1 ? "onlyOne" : "tooMany") : problem);
  }

  function readPastedImage(file: File) {
    const mime = file.type as ChatTurnImage["mime_type"];
    const seq = (imageSeqRef.current += 1);
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = typeof reader.result === "string" ? reader.result : "";
      const data = dataUrl.slice(dataUrl.indexOf(",") + 1);
      if (!data) {
        imageSlotsRef.current = Math.max(0, imageSlotsRef.current - 1);
        return;
      }
      const image: AttachedImage = { data, mime_type: mime, previewUrl: createPreviewUrl(file, dataUrl), seq };
      // Functional update + paste order: two quick reads can never overwrite each other.
      setAttachedImages((current) => [...current, image].sort((a, b) => a.seq - b.seq));
    };
    reader.onerror = () => {
      imageSlotsRef.current = Math.max(0, imageSlotsRef.current - 1);
      setImageHint("unsupported");
    };
    reader.readAsDataURL(file);
  }

  function removeAttachedImage(seq: number) {
    imageSlotsRef.current = Math.max(0, imageSlotsRef.current - 1);
    setAttachedImages((current) => current.filter((image) => image.seq !== seq));
    setImageHint(null);
  }

  function clearAttachedImages() {
    imageSlotsRef.current = 0;
    setAttachedImages([]);
  }

  function patchTurn(id: string, patch: (turn: Turn) => Turn) {
    setTranscript((turns) => turns.map((turn) => (turn.id === id ? patch(turn) : turn)));
  }

  async function sendImageTurn(id: string, text: string, images: ChatTurnImage[]) {
    try {
      await send(text, images);
      imageDraftsRef.current.delete(id);
      patchTurn(id, ({ imageSend: _done, ...rest }) => rest);
      awaitingFailureEventIdsRef.current = new Set(appEvents.map((event) => event.id));
      setAwaitingReply(true);
      setAwaitingBaseline(currentTurnId);
    } catch (err: unknown) {
      // The failure is shown on the message with a cause-specific line, so the
      // generic send alert below must not repeat it.
      resetSend();
      patchTurn(id, (turn) => ({
        ...turn,
        imageSend: {
          phase: "failed",
          errorKey: chatImageErrorKey(err),
          failedImage: err instanceof ChatImageError ? err.failedImage : null
        }
      }));
    }
  }

  // Retry/Discard are handed to memoized rows, so they read the latest closure
  // through a ref instead of changing identity on every render.
  const sendImageTurnRef = useRef(sendImageTurn);
  sendImageTurnRef.current = sendImageTurn;
  const sendBusyRef = useRef(pending);
  sendBusyRef.current = pending;
  const retryImageTurn = useCallback((id: string) => {
    const draft = imageDraftsRef.current.get(id);
    if (!draft || sendBusyRef.current) return;
    setTranscript((turns) =>
      turns.map((turn) => (turn.id === id ? { ...turn, imageSend: { phase: "sending", waiting: false } } : turn))
    );
    void sendImageTurnRef.current(id, draft.text, draft.images);
  }, []);
  const discardImageTurn = useCallback((id: string) => {
    imageDraftsRef.current.delete(id);
    setTranscript((turns) => turns.filter((turn) => turn.id !== id));
  }, []);

  function handleCancelPendingMessage() {
    if (pendingMessage) {
      setMessage(pendingMessage.text);
      setPendingMessage(null);
    }
    setShowRecoveryModal(false);
    focusComposerInput();
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return; // block concurrent submits (e.g. rapid Enter presses)
    if (liveDictatingRef.current) return; // never send a half dictation
    let text = message.trim();
    if (!text && attachedImages.length === 0) return;
    const images: ChatTurnImage[] = attachedImages.map(({ data, mime_type }) => ({ data, mime_type }));
    const image = images.length > 0 ? images : undefined;
    const visionCommand = parseVisionCommand(text);
    if (visionCommand) {
      // Not ready: never send the command text; keep the draft and say why.
      const result = await executeVisionCommand(visionCommand, {
        visionData,
        armLook: (mode) => lookNow.mutateAsync(mode)
      });
      if (!result.ok) {
        setVisionCommandBlocked(true);
        return;
      }
      if (!result.rest) {
        setMessage("");
        return;
      }
      text = result.rest;
    }
    // Slash/bang commands are owned by the command palette (mockup), never sent
    // as a chat turn. A normal message (no "/"/"!" prefix) submits as before.
    if (showCommandPanel) return;

    // The recovery modal replays text only, so a turn with an image goes straight
    // to the backend (which answers 409 while the engine is down) and keeps the draft.
    if (isEngineUnready && !image) {
      setPendingMessage({
        id: crypto.randomUUID(),
        text,
        status: "WAITING_FOR_ENGINE"
      });
      setMessage("");
      setShowRecoveryModal(true);
      return;
    }

    if (image) {
      // The message (with its thumbnail) goes into the conversation now and the
      // composer is free again; the send, its failure and Retry live on the message.
      const id = crypto.randomUUID();
      const previewUrls = attachedImages.map((one) => one.previewUrl);
      imageDraftsRef.current.set(id, { text, images });
      setTranscript((turns) =>
        capTurns([
          ...turns,
          {
            id,
            kind: "chat",
            role: "operator",
            text,
            ts: Date.now(),
            hasImage: true,
            imagePreviewUrls: previewUrls,
            imageSend: { phase: "sending", waiting: composerVision.phase === "starting" }
          }
        ])
      );
      setMessage("");
      clearAttachedImages();
      setImageHint(null);
      await sendImageTurn(id, text, images);
      return;
    }

    const turnId = pendingTurnIdRef.current ?? crypto.randomUUID();
    pendingTurnIdRef.current = turnId;
    setTranscript((turns) => {
      const existingIndex = turns.findIndex((turn) => turn.id === turnId);
      const hasImage = image !== undefined;
      if (existingIndex === -1) return capTurns([...turns, { id: turnId, kind: "chat", role: "operator", text, ts: Date.now(), hasImage }]);
      const next = [...turns];
      next[existingIndex] = { ...next[existingIndex], text, hasImage };
      return next;
    });

    try {
      await send(text, image);
      setMessage("");
      clearAttachedImages();
      setImageHint(null);
      pendingTurnIdRef.current = null;
      awaitingFailureEventIdsRef.current = new Set(appEvents.map((event) => event.id));
      setAwaitingReply(true);
      setAwaitingBaseline(currentTurnId);
    } catch (err: unknown) {
      if (!image && typeof err === "object" && err !== null && "status" in err && (err as { status: number }).status === 409) {
        setPendingMessage({
          id: turnId,
          text,
          status: "WAITING_FOR_ENGINE"
        });
        setMessage("");
        setShowRecoveryModal(true);
      }
      // isError/error below already carry this reactively — the message
      // stays in the input so the operator can retry without retyping it.
      // pendingTurnIdRef stays set so that retry reuses (and updates) the
      // same bubble instead of appending a duplicate.
    }
  }

  /**
   * Hand focus back to the composer's OWN text field.
   *
   * Not `querySelector("input")`: both command surfaces mount inside
   * `composerRef`, and a Stepper's first step is very often a text field — so
   * the bare selector matched the STEPPER's input, focused it, and then watched
   * it get unmounted along with the panel, dropping focus to <body>. Caught by
   * the Cancelar test. The id is the same fixed-id convention the timeline
   * (`conversation-panel`) and the launcher listbox already use here.
   */
  function focusComposerInput() {
    composerRef.current?.querySelector<HTMLTextAreaElement>(`#${COMPOSER_INPUT_ID}`)?.focus();
  }

  function closeLauncherCommand() {
    setLauncherCommandId(null);
    focusComposerInput();
  }

  function handleMicPointerDown(event: ReactPointerEvent<HTMLButtonElement>) {
    event.currentTarget.setPointerCapture?.(event.pointerId); // guarantees the up event even off-button; optional-chained for jsdom
    if (micDegraded) setMicGuidanceRequested(true);
    pttStart();
  }

  function handleMicKeyDown(event: ReactKeyboardEvent<HTMLButtonElement>) {
    if (event.repeat) return;
    if (event.key !== " " && event.key !== "Enter") return;
    event.preventDefault(); // suppress the button's own native space-triggers-click
    if (micDegraded) setMicGuidanceRequested(true);
    pttStart();
  }

  function handleMicClick() {
    if (micDegraded) setMicGuidanceRequested(true);
  }

  function handleMicKeyUp(event: ReactKeyboardEvent<HTMLButtonElement>) {
    if (event.key !== " " && event.key !== "Enter") return;
    pttStop();
  }

  function scrollToBottom() {
    const el = scrollRef.current;
    if (!el) return;
    // Optional-chained: jsdom has no scrollTo, the real WebView2 shell does.
    el.scrollTo?.({ top: el.scrollHeight, behavior: "smooth" });
    setShowJump(false);
    nearBottomRef.current = true;
  }

  // Show the jump pill whenever the operator is scrolled up past the threshold
  // (independent of new arrivals — that's the owner's fix), hide it once they're
  // back near the bottom.
  //
  // rAF-throttled: the follow effect below scrolls with behavior:"smooth" (the
  // owner's "ir lentamente bajando"), and a smooth scroll emits a scroll event
  // on EVERY frame of its animation. Each one used to force three synchronous
  // layout reads inline, so one append could cost dozens of reflows. Coalescing
  // to at most one read per frame — taken inside the frame callback, after
  // layout, instead of mid-event — removes the storm without changing behavior
  // or dropping the smooth scroll the owner asked for.
  const scrollRafRef = useRef<number | null>(null);
  const handleTimelineScroll = useCallback(() => {
    if (scrollRafRef.current !== null) return; // a read is already queued for this frame
    scrollRafRef.current = requestAnimationFrame(() => {
      scrollRafRef.current = null;
      const el = scrollRef.current;
      if (!el) return;
      const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight <= NEAR_BOTTOM_PX;
      nearBottomRef.current = nearBottom;
      setShowJump(!nearBottom);
    });
  }, []);

  useEffect(
    () => () => {
      if (scrollRafRef.current !== null) cancelAnimationFrame(scrollRafRef.current);
    },
    []
  );

  // ONE memoized pass over the whole history. This used to run
  // map -> map -> spread -> sort -> filter across the entire timeline on EVERY
  // render — and renders here are driven by four independent polls (status,
  // chat last-reply, agenda, engine events) plus every composer keystroke, PTT
  // state change and toast timer. Keyed on its real inputs, so typing a message
  // no longer re-sorts the stream, and the resulting array identity is stable
  // enough for the memoized ConversationTurn rows below to actually bail out.
  const visibleTurns = useMemo(() => {
    const agendaTurns: Turn[] = agendaEvents.map((event) => ({
      id: event.id,
      kind: "alert",
      event: event.label,
      eventSource: "agenda",
      ts: event.ts
    }));
    const visionOffTurns: Turn[] = visionOffRequests.map((request) => ({
      id: request.id,
      kind: "alert",
      visionOff: true,
      ts: request.ts
    }));
    const appEventTurns: Turn[] = appEvents.map((event) => ({
      id: event.id,
      kind: "alert",
      event: event.label,
      eventSource: event.source,
      tone: event.tone,
      ts: event.ts
    }));
    // The real stream: operator sends, Kira replies, and agenda/app events
    // interleaved by client arrival time (Date.now() at observe-time), then the
    // ephemeral "pensando" indicator closes it out.
    const interleaved = [...transcript, ...agendaTurns, ...appEventTurns, ...visionOffTurns].sort((a, b) => (a.ts ?? 0) - (b.ts ?? 0));
    const visionBadges = attachVisionBadges(interleaved, visionResults);
    for (let i = 0; i < interleaved.length; i += 1) {
      const badge = visionBadges.get(interleaved[i]!.id);
      if (badge) interleaved[i] = { ...interleaved[i]!, visionBadge: badge };
    }
    const kiraThinkingTurn: Turn | null = isThinking
      ? {
          id: KIRA_THINKING_ID,
          kind: "chat",
          role: "kira",
          // D3b: direct chat never interrupts — Kira finishes the current
          // block and answers on the NEXT turn (D3). Honest receipt for that
          // wait instead of implying she's generating THIS answer right now.
          pendingNote: kiraBusy ? t("experiencia.conversationPanel.turn.pendingBusy") : undefined
        }
      : null;
    const orderedTurns = [...interleaved, ...(kiraThinkingTurn ? [kiraThinkingTurn] : [])];
    return orderedTurns.filter((turn) => matchesTab(activeTab, turn.kind));
    // `t` is in the deps because this memo bakes a translated string into
    // `pendingNote`: useT() hands back a fresh identity per locale, so listing
    // it here is what makes the note re-translate on a language flip.
  }, [transcript, agendaEvents, appEvents, visionOffRequests, visionResults, isThinking, activeTab, kiraBusy, t]);

  // Identity of the last CONTENT row. The "pensando" sentinel is always last
  // while it exists (it is appended after the sort), so skipping it is one index
  // step — and it must be skipped, or its whole multi-second window reads as
  // "nothing arrived at the end".
  const lastRow = visibleTurns[visibleTurns.length - 1];
  const lastTurnId =
    (lastRow?.id === KIRA_THINKING_ID ? visibleTurns[visibleTurns.length - 2]?.id : lastRow?.id) ?? null;

  // On a genuine append AT THE END: follow the bottom if the operator is already
  // near it (behavior:'smooth', "ir lentamente bajando"); otherwise don't yank —
  // surface the floating jump-to-recent button. Pure scrollTop math on the
  // existing container (jsdom-testable; no IntersectionObserver).
  //
  // A change of this ONE id is the whole condition, and it answers all five
  // cases: ordinary append -> scroll; backfilled batch (an event or a reply
  // carrying an older real timestamp) sorting into the MIDDLE -> the bottom row
  // is unchanged, so no yank away from whatever the operator was reading;
  // append during the "pensando" window -> scroll (the sentinel is skipped);
  // append at TRANSCRIPT_CAP, where the count can no longer grow because every
  // arrival evicts one -> scroll; plain re-render -> nothing changed, no scroll.
  // The row count that used to gate this was doing the "is it a real append"
  // job WRONG in the last two of those, so it is gone rather than kept as a
  // second opinion.
  //
  // T6 fix: "near the bottom" is read from `nearBottomRef` (the last GENUINE
  // scroll event), not re-measured here. By the time this effect runs, React
  // has already committed the new turn — appending it grows `scrollHeight`
  // while `scrollTop` hasn't moved, so a live re-measurement here would almost
  // always read "far from the bottom" for any real-sized append (the
  // operator's own bubble, then the "pensando" row), even when the operator
  // was sitting AT the bottom a moment before sending. That silently broke
  // "seguir lectura" on every send. `nearBottomRef` is immune to this because
  // appending DOM content, on its own, never fires a 'scroll' event.
  useEffect(() => {
    const el = scrollRef.current;
    // A null id means the list has no content rows (a filter switch emptied it) —
    // that is not an append.
    const appendedLast = lastTurnId !== null && lastTurnId !== prevLastTurnIdRef.current;
    prevLastTurnIdRef.current = lastTurnId;
    if (!el || !appendedLast) return;
    if (nearBottomRef.current) {
      el.scrollTo?.({ top: el.scrollHeight, behavior: "smooth" });
      setShowJump(false);
    } else {
      setShowJump(true);
    }
  }, [lastTurnId]);

  // Empty-state rule (§3b(i), revision #4): the invitation shows on Todo/Chat
  // whenever there are ZERO chat-kind turns (no transcript turns, no thinking
  // indicator), REGARDLESS of alert-kind event lines — motor.* events land
  // within seconds of startup and must not kill the invitation. Alertas keeps
  // its own "Sin turnos en este filtro." empty case.
  const hasChatKindTurns = transcript.length > 0 || isThinking;
  const showEmptyState = activeTab !== "alertas" && !hasChatKindTurns;

  const micLabel =
    pttState === "connecting"
      ? t("experiencia.conversationPanel.mic.state.connecting")
      : pttState === "listening"
        ? t("experiencia.conversationPanel.mic.state.listening")
        : pttState === "flushing"
          ? t("experiencia.conversationPanel.mic.state.flushing")
          : t("experiencia.conversationPanel.mic.state.idle");
  const showMicOff = micDegraded && pttState === "idle";
  const MicGlyph = showMicOff ? MicOff : Mic;
  const showLiveAudioGuidance =
    pttError === "stt_unreachable" || (pttError === null && micDegraded && micGuidanceRequested);

  // Todo/Chat/Alertas show the feed (timeline + composer); Comandos/Logs swap
  // the panel. The feed region stays MOUNTED (hidden + inert) when a non-feed
  // tab is active so the timeline scroll survives (R6); the composer, though, is
  // unmounted so it truly leaves the a11y tree and no "/" palette is reachable
  // from it (R8).
  const feedActive = activeTab === "todo" || activeTab === "chat" || activeTab === "alertas";
  const feedTabId = FEED_TAB_ID[feedActive ? (activeTab as "todo" | "chat" | "alertas") : "todo"];

  // min-w-0 on the aside: it is a grid item, so its automatic min size is
  // min-content — one wide Kira table/code reply used to force it past the
  // fixed 465px chat column and break the whole app layout (runtime session
  // 2026-08-07, 15:40). With the floor at 0 the column holds and the
  // table/pre overflow-x-auto wrappers in Markdown.tsx do the scrolling.
  return (
    <aside className="flex min-h-0 min-w-0 flex-col border-l border-border-soft bg-card">
      <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as TabValue)} className="flex min-h-0 flex-1 flex-col">
        {/* ONE unified strip (owner layout correction 2026-07-18): Todo/Chat/
            Alertas filter the timeline (they share the single "conversation-panel"
            via a fixed id/aria-controls); Comandos and Logs swap the panel. */}
        <TabList ariaLabel={t("experiencia.conversationPanel.tabs.aria")} className="flex gap-1 border-b border-border-soft px-3 py-2">
          <Tab value="todo" id={FEED_TAB_ID.todo} controls="conversation-panel" className={tabClass(activeTab === "todo")}>{t("experiencia.conversationPanel.tabs.todo")}</Tab>
          <Tab value="chat" id={FEED_TAB_ID.chat} controls="conversation-panel" className={tabClass(activeTab === "chat")}>{t("experiencia.conversationPanel.tabs.chat")}</Tab>
          <Tab value="comandos" className={tabClass(activeTab === "comandos")}>{t("experiencia.conversationPanel.tabs.comandos")}</Tab>
          <Tab value="alertas" id={FEED_TAB_ID.alertas} controls="conversation-panel" className={tabClass(activeTab === "alertas")}>{t("experiencia.conversationPanel.tabs.alertas")}</Tab>
          <Tab value="stream" className={cn(tabClass(activeTab === "stream"), "relative")}>
            {t("experiencia.conversationPanel.tabs.stream")}
            {unreadStream && (
              <span
                aria-hidden="true"
                data-unread
                className="ml-1.5 inline-block h-1.5 w-1.5 rounded-full bg-primary align-middle"
              />
            )}
          </Tab>
          {showLogs && (
            <Tab value="logs" className={cn(tabClass(activeTab === "logs"), "relative")}>
              {t("experiencia.conversationPanel.tabs.logs")}
              {unreadLogs && (
                <span
                  aria-hidden="true"
                  data-unread
                  className="ml-1.5 inline-block h-1.5 w-1.5 rounded-full bg-primary align-middle"
                />
              )}
            </Tab>
          )}
        </TabList>

        {/* Feed region — shown for Todo/Chat/Alertas, kept MOUNTED (hidden +
            inert + aria-hidden) on Comandos/Logs so the timeline scroll survives
            (R6). It is NOT a <TabPanel> because three filter tabs share it. */}
        <div
          hidden={!feedActive}
          inert={!feedActive ? "" : undefined}
          aria-hidden={!feedActive}
          style={!feedActive ? { display: "none" } : undefined}
          className={cn("flex min-h-0 flex-1 flex-col", !feedActive && "pointer-events-none")}
        >
          <div className="flex items-center justify-between px-3 py-1.5">
            <span className="mono text-[11px] font-semibold uppercase tracking-[0.09em] text-dim">{t("experiencia.conversationPanel.feed.eyebrow")}</span>
            <div className="inline-flex items-center gap-3">
              <PrivateModeControl
                checked={privateMode}
                available={privateAvailable}
                error={privateError}
                onToggle={handleTogglePrivateMode}
              />
              <div className="inline-flex items-center gap-2">
                <span
                  onClick={() => handleToggleAutoFollow(!autoFollow)}
                  className="cursor-pointer select-none text-[11.5px] font-medium text-muted-foreground transition-colors hover:text-foreground"
                >
                  {t("experiencia.conversationPanel.autoFollow")}
                </span>
                <Switch
                  checked={autoFollow}
                  onChange={handleToggleAutoFollow}
                  aria-label={t("experiencia.conversationPanel.autoFollow")}
                />
              </div>
            </div>
          </div>


          <div className="relative flex min-h-0 flex-1 flex-col">
            <div
              role="tabpanel"
              id="conversation-panel"
              tabIndex={0}
              ref={scrollRef}
              onScroll={handleTimelineScroll}
              aria-labelledby={feedTabId}
              className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto px-3 pb-3 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              {needsTurnFragments && feedTurnId != null && (
                <SpokenTurnFragmentsLoader turnId={feedTurnId} version={speechTotal} onLoaded={setFetchedFragments} />
              )}
              {visibleTurns.map((turn) => {
                // Only the reply-feed turn the backend says is being spoken.
                // A null feed id (read-aloud, vision, notices) highlights nothing.
                const isSpeakingTurn = feedTurnId != null && turn.id === spokenTurnId;
                return (
                  <ConversationTurn
                    key={turn.id}
                    turn={isSpeakingTurn && spokenFragments ? { ...turn, fragments: spokenFragments } : turn}
                    operatorName={operatorName}
                    isSpeakingTurn={isSpeakingTurn}
                    isStreamingTurn={Boolean(lastReply.data?.is_streaming) && turn.id === `kira-reply-${lastReply.data?.turn_id}`}
                    autoFollow={autoFollow}
                    onReadAloud={readAloud.say}
                    onRetryImage={retryImageTurn}
                    onDiscardImage={discardImageTurn}
                  />
                );
              })}
              {showEmptyState && (
                isEngineUnready ? (
                  <div className="m-auto w-full max-w-md p-4 animate-rise-in">
                    <LlmReadinessCard />
                  </div>
                ) : (
                  <div className="m-auto flex flex-col items-center gap-2 py-8 text-center animate-rise-in">
                    <KiraFace size={40} aria-hidden />
                    <p className="text-sm font-semibold text-foreground">{t("experiencia.conversationPanel.empty.title")}</p>
                    <p className="max-w-[220px] text-xs text-muted-foreground">
                      {t("experiencia.conversationPanel.empty.hint")}
                    </p>
                  </div>
                )
              )}
              {activeTab === "alertas" && visibleTurns.length === 0 && (
                <p className="text-xs text-dim">{t("experiencia.conversationPanel.alertas.empty")}</p>
              )}
            </div>
            {showJump && (
              <button
                type="button"
                onClick={scrollToBottom}
                aria-label={t("experiencia.conversationPanel.jump.action")}
                title={t("experiencia.conversationPanel.jump.action")}
                className="absolute bottom-2 right-4 z-10 flex h-11 w-11 items-center justify-center rounded-full border border-border-soft bg-card text-foreground shadow-panel animate-rise-in transition-colors duration-fast ease-io hover:bg-surface-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              >
                <ChevronDown size={22} aria-hidden="true" />
              </button>
            )}
          </div>

          {feedActive && (
            <ReadAloudControls
              state={speechState.data}
              selectedText={selectedText}
              busy={readAloud.busy}
              errorKind={readAloud.errorKind}
              onSay={(text, mode) => {
                readAloud.say(text, mode);
                clearSelection();
              }}
              onStop={readAloud.stop}
              onPause={readAloud.pause}
              onResume={readAloud.resume}
            />
          )}

          {/* "Mira esto" button hidden: the voice/text rule gate already triggers a look (es/en).
          {feedActive && <VisionLookControl />}
          */}

          {feedActive && (
            <div ref={composerRef} className="relative border-t border-border-soft bg-surface-2 p-3">
              {/* Emergent command launcher (owner layout correction 2026-07-18):
                  appears above the composer only while the input starts with
                  "/"|"!". Selecting a command opens it RIGHT HERE, in the
                  floating panel below — it used to jump to the Comandos tab,
                  which threw the operator out of the conversation mid-stream
                  (owner correction 2026-08-11). */}
              {launcherOpen && (
                <CommandPalettePopover
                  query={message}
                  composerRef={composerRef}
                  onActiveDescendantChange={setActiveDescendant}
                  onSelect={(id) => {
                    setLauncherCommandId(id);
                    setMessage("");
                  }}
                  onClose={() => {
                    setMessage("");
                    // Restore focus to the composer input the operator was typing in.
                    focusComposerInput();
                  }}
                />
              )}
              {/* The floating host has existed since the mockup and was never
                  mounted — `ComposerCommandPanel` without `inline` is exactly
                  this: a role="dialog" above the composer hosting the picked
                  command's Stepper. Cancel/Escape/discard all resolve to
                  activeId=null, which unmounts it and returns the operator to a
                  conversation that never went anywhere. */}
              {launcherCommandId !== null && (
                <ComposerCommandPanel
                  query=""
                  activeId={launcherCommandId}
                  // Every exit funnels through here: Escape and Stepper-discard
                  // both go out as activeId=null, Cancelar comes in on onClose.
                  // Focus has to come back to the input either way — the panel
                  // is unmounting out from under whatever held it.
                  onActiveIdChange={(id) => (id === null ? closeLauncherCommand() : setLauncherCommandId(id))}
                  onClose={closeLauncherCommand}
                />
              )}
              {showRecoveryModal && isEngineUnready && !showEmptyState && (
                <div className="absolute inset-x-0 bottom-full z-20 border-t border-border-soft bg-background/95 p-2 shadow-panel backdrop-blur-sm">
                  <LlmReadinessCard
                    showDismiss
                    onClose={handleCancelPendingMessage}
                  />
                </div>
              )}

              {pendingMessage && (
                <div className="mb-2 flex items-center justify-between gap-2 rounded bg-surface-2 p-2 text-xs">
                  <span className="truncate text-muted-foreground">
                    {t("experiencia.conversationPanel.pending.waiting")}{" "}
                    <strong className="text-foreground">{pendingMessage.text}</strong>
                  </span>
                  <Button
                    type="button"
                    variant="outline"
                    className="h-6 shrink-0 px-2 text-xs"
                    onClick={handleCancelPendingMessage}
                  >
                    {t("experiencia.conversationPanel.pending.cancel")}
                  </Button>
                </div>
              )}
              <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">


                {voiceSent && (
                  <p role="status" className="mono flex items-center gap-1.5 text-[11px] text-dim animate-rise-in">
                    <Mic size={12} aria-hidden="true" />
                    {t("experiencia.conversationPanel.composer.voiceSent")}
                  </p>
                )}
                {dictationNotice === "dictated" && (
                  <p role="status" className="mono flex items-center gap-1.5 text-[11px] text-dim animate-rise-in">
                    <Mic size={12} aria-hidden="true" />
                    {t("experiencia.conversationPanel.composer.dictated")}
                  </p>
                )}
                {liveDictating && (
                  <p role="status" className="mono flex items-center gap-1.5 text-[11px] text-dim animate-rise-in">
                    <Mic size={12} aria-hidden="true" />
                    {t("experiencia.conversationPanel.composer.dictating")}
                  </p>
                )}
                {dictationNotice === "incomplete" && (
                  <p role="alert" className="flex items-center gap-1.5 text-[11px] text-warn animate-rise-in">
                    <MicOff size={12} aria-hidden="true" />
                    {t("experiencia.conversationPanel.composer.dictationIncomplete")}
                  </p>
                )}
                {dictationNotice === "lost" && (
                  <p role="alert" className="flex items-center gap-1.5 text-[11px] text-warn animate-rise-in">
                    <MicOff size={12} aria-hidden="true" />
                    {t("experiencia.conversationPanel.composer.dictationLost")}
                  </p>
                )}
              {/* role="alert" (assertive) + icon + rise-in: a live PTT failure must
                  actually register — the old bare 11px line was easy to miss. */}
                {(pttError || showLiveAudioGuidance) && (
                  <p role="alert" className="mono flex items-center gap-1.5 text-[11px] font-semibold text-danger animate-rise-in">
                    <MicOff size={12} aria-hidden="true" />
                    {showLiveAudioGuidance
                      ? t("experiencia.ptt.error.sttUnreachable")
                      : errorCopy(pttError!)}
                    {showLiveAudioGuidance && (
                      <a
                        href="https://liveaudio.opencohost.com"
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 text-primary underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                      >
                        {t("experiencia.ptt.liveAudio.download")}
                        <ExternalLink size={11} aria-hidden="true" />
                      </a>
                    )}
                  </p>
                )}
              </div>

              {visionCommandBlocked && (
                <p role="alert" className="mono mt-2 text-[11px] font-semibold text-warn">
                  {t("experiencia.vision.command.notReady")}
                </p>
              )}

              {imageHint && (
                <p role="status" className="mono mt-2 text-[11px] font-semibold text-warn">
                  {t(`experiencia.conversationPanel.composer.image.hint.${imageHint}`, { max: visionMaxImages(visionData) })}
                </p>
              )}

              <form onSubmit={handleSubmit} className="mt-2">
                {attachedImages.length > 0 && (
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    {attachedImages.map((attached, index) => {
                      const several = attachedImages.length > 1;
                      return (
                        <div
                          key={attached.seq}
                          className="inline-flex items-center gap-2 rounded-md border border-border bg-surface-2 py-1 pl-1 pr-2 text-[11px] font-semibold text-dim"
                        >
                          <img src={attached.previewUrl} alt="" className="h-8 w-8 rounded-sm object-cover" />
                          <span>
                            {several
                              ? t("experiencia.conversationPanel.composer.image.attachedN", { n: index + 1 })
                              : t("experiencia.conversationPanel.composer.image.attached")}
                          </span>
                          <button
                            type="button"
                            aria-label={
                              several
                                ? t("experiencia.conversationPanel.composer.image.removeN", { n: index + 1 })
                                : t("experiencia.conversationPanel.composer.image.remove")
                            }
                            onClick={() => removeAttachedImage(attached.seq)}
                            className="flex h-5 w-5 items-center justify-center rounded-sm text-muted-foreground hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                          >
                            <X size={12} aria-hidden="true" />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
                <Textarea
                  id={COMPOSER_INPUT_ID}
                  value={message}
                  onChange={handleMessageChange}
                  onSelect={captureComposerSelection}
                  onBlur={captureComposerSelection}
                  onPaste={handlePaste}
                  readOnly={liveDictating}
                  placeholder={
                    liveDictating
                      ? t("experiencia.conversationPanel.composer.dictating")
                      : t("experiencia.conversationPanel.composer.input.placeholder")
                  }
                  aria-label={t("experiencia.conversationPanel.composer.input.aria")}
                  // F3: combobox pattern — the launcher popover is this input's
                  // listbox; aria-activedescendant follows its keyboard highlight.
                  role="combobox"
                  aria-expanded={commandListboxOpen}
                  aria-controls={commandListboxOpen ? COMMAND_PALETTE_LISTBOX_ID : undefined}
                  aria-activedescendant={commandListboxOpen ? (activeDescendant ?? undefined) : undefined}
                  trailing={
                    <div className="flex items-stretch">
                      <button
                        type="button"
                        aria-label={micLabel}
                        aria-pressed={pttState === "listening"}
                        title={showMicOff ? t("experiencia.conversationPanel.mic.unavailable.hint") : undefined}
                        onPointerDown={handleMicPointerDown}
                        onPointerUp={pttStop}
                        onPointerCancel={pttStop}
                        onLostPointerCapture={pttStop}
                        onKeyDown={handleMicKeyDown}
                        onKeyUp={handleMicKeyUp}
                        onClick={handleMicClick}
                        className={cn(
                          "relative flex h-full w-10 touch-none select-none items-center justify-center overflow-hidden transition-colors duration-fast",
                          "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                          pttState === "idle" && !micDegraded && "text-muted-foreground hover:text-foreground",
                          showMicOff && "text-muted-foreground opacity-60",
                          // connecting: tint the whole button, not just the 16px
                          // glyph — same treatment family as the listening wash.
                          pttState === "connecting" && "bg-info-bg text-info animate-pulse",
                          pttState === "listening" && "bg-danger-bg text-danger animate-pulse",
                          pttState === "flushing" && "text-muted-foreground animate-pulse"
                        )}
                      >
                        {/* Hold-fill: rises while listening, drains fast on release.
                            Pure visual (aria-hidden); state is carried by aria-pressed. */}
                        <span
                          aria-hidden="true"
                          className={cn("mic-fill pointer-events-none absolute inset-0", pttState === "listening" && "mic-fill--filling")}
                        />
                        <MicGlyph size={16} aria-hidden="true" className="relative z-[1]" />
                      </button>
                      <button
                        type="submit"
                        disabled={pending || liveDictating}
                        className="flex items-center px-4 text-sm font-semibold bg-[image:var(--accent-grad)] text-[var(--accent-contrast)] transition-opacity disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                      >
                        {t("experiencia.conversationPanel.composer.send.action")}
                      </button>
                    </div>
                  }
                />
              </form>
            </div>
          )}

          {isError && feedActive && (
            <div className="px-3 pb-3">
              <Alert tone="danger">{error?.message ?? t("experiencia.conversationPanel.send.error")}</Alert>
            </div>
          )}
        </div>

        <TabPanel value="comandos" className="flex min-h-0 flex-1 flex-col overflow-auto p-3">
          {/* R9: same COMMANDS registry as the launcher, rendered inline (no
              floating dialog). It is the browsable home; the launcher opens a
              command here via the controlled activeId. `visible` gates its Escape
              handler so, while hidden, it never swallows the launcher's Escape. */}
          <ComposerCommandPanel
            inline
            query=""
            activeId={comandoId}
            onActiveIdChange={setComandoId}
            visible={activeTab === "comandos"}
            onClose={() => setActiveTab("todo")}
          />
        </TabPanel>

        <TabPanel value="stream" className="flex min-h-0 flex-1 flex-col">
          <StreamChatPanel active={activeTab === "stream"} />
        </TabPanel>

        {showLogs && (
          <TabPanel value="logs" className="flex min-h-0 flex-1 flex-col p-3">
            <LogsPanel />
          </TabPanel>
        )}
      </Tabs>
    </aside>
  );
}
