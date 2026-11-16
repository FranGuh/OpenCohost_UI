/**
 * Splits one Kira reply (LLM markdown, possibly still streaming) into a few
 * readable chat bubbles.
 *
 * Design goals, in priority order:
 *  1. Calm, not chatty: a reply becomes at most REPLY_SEGMENT_MAX bubbles and a
 *     bubble is only closed once it holds REPLY_SEGMENT_MIN_CHARS. Short replies
 *     therefore always stay one bubble.
 *  2. Never break meaning: cuts happen only between whole paragraphs, or
 *     between whole sentences of a long prose paragraph. Lists, code fences,
 *     tables, quotes, math blocks and headings are never cut through, a heading
 *     or a "...:" intro stays with what follows, and the text after a list
 *     stays with the list.
 *  3. Stable while streaming: every decision depends only on the text BEFORE a
 *     cut plus the first character AFTER it (a cut exists only once it is
 *     final). So for any prefix of a reply, the closed bubbles are exactly the
 *     final ones and only the last bubble grows: nothing re-flows or jumps.
 *     The cost of that guarantee: a reply may end with a short last bubble
 *     (e.g. a closing question), because the future length of the tail is
 *     unknown when the cut is made.
 *
 * The backend's TTS fragments are not reused on purpose: they are sanitized
 * (markdown and newlines stripped) and cut at every terminator, including
 * abbreviations, so they do not map back onto the rendered markdown.
 */

/** A bubble is closed at a paragraph break only once it holds this many
 * characters: about two short sentences, or two lines of the chat panel at
 * its usual width. Below it, paragraphs merge into the same bubble. */
export const REPLY_SEGMENT_MIN_CHARS = 140;
/** A single prose paragraph is cut between sentences only once the bubble
 * holds this many characters (about five lines). Medium paragraphs stay whole;
 * only a real wall of text is broken up. */
export const REPLY_SEGMENT_LONG_CHARS = 300;
/** Hard cap: any text beyond the last allowed cut stays in the last bubble. */
export const REPLY_SEGMENT_MAX = 3;

interface Candidate {
  /** Offset where the next bubble would start. */
  offset: number;
  /** Minimum trimmed length of the bubble this cut would close. */
  minChars: number;
}

type LineKind = "prose" | "list" | "heading" | "table" | "quote" | "rule" | "fence" | "math" | "code" | "indented";

interface Chunk {
  start: number;
  /** End of the last non-blank line seen so far. */
  end: number;
  firstKind: LineKind;
  listy: boolean;
  lastLine: string;
  lastKind: LineKind;
  /** End of the leading run of prose lines: the only range where sentence cuts are allowed. */
  proseEnd: number | null;
}

const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})/;
const MATH_FENCE = /^[ \t]*\$\$[ \t\r]*$/;
const RULE = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t\r]*$/;
const LIST_ITEM = /^[ \t]*(?:[-*+•]|\d{1,3}[.)])[ \t]/;
const HEADING = /^ {0,3}#{1,6}(?:[ \t]|\r?$)/;
const TABLE = /^[ \t]*\|/;
const QUOTE = /^ {0,3}>/;
const INDENTED = /^(?: {4}|\t)/;

function classify(line: string): LineKind {
  if (FENCE_OPEN.test(line)) return "fence";
  if (MATH_FENCE.test(line)) return "math";
  if (RULE.test(line)) return "rule";
  if (LIST_ITEM.test(line)) return "list";
  if (HEADING.test(line)) return "heading";
  if (TABLE.test(line)) return "table";
  if (QUOTE.test(line)) return "quote";
  if (INDENTED.test(line)) return "indented";
  return "prose";
}

function isFenceClose(line: string, open: string): boolean {
  const m = /^ {0,3}(`{3,}|~{3,})[ \t\r]*$/.exec(line);
  return m !== null && m[1][0] === open[0] && m[1].length >= open.length;
}

/** A cut at a paragraph break is allowed only between self-contained blocks. */
function paragraphCutAllowed(prev: Chunk, nextLine: string): boolean {
  if (prev.listy) return false; // loose list items and a list's wrap-up stay together
  if (prev.lastKind === "heading") return false; // a heading belongs to what follows
  if (prev.lastLine.trimEnd().endsWith(":")) return false; // "here you go:" + its block
  if (/^[ \t]/.test(nextLine)) return false; // indented continuation or code
  return true;
}

/**
 * Multi-letter abbreviations that end with a dot but rarely end a sentence.
 * Lowercased, without the trailing dot. Missing a real cut is cheap; a false
 * cut splits a sentence, so the list errs on the side of not cutting.
 */
const ABBREVIATIONS = new Set([
  "sr", "sra", "srta", "sres", "dr", "dra", "drs", "ud", "uds", "vd", "vds", "dto", "dpto", "depto",
  "prof", "profa", "lic", "ing", "arq", "av", "avda", "etc", "ej", "pág", "págs", "pag", "núm", "num",
  "aprox", "tel", "vol", "cap", "art", "fig", "máx", "mín", "min", "max", "seg", "hrs", "cía", "sto", "sta",
  "mr", "mrs", "ms", "jr", "st", "vs", "approx", "inc", "ltd", "co", "dept", "est", "misc"
]); // "no." is left out on purpose: it ends real sentences in both languages

function isAbbreviation(textBefore: string): boolean {
  const m = /[\p{L}.]+$/u.exec(textBefore);
  if (!m) return false; // "2024." or ")." is a normal sentence end
  const token = m[0].replace(/^\.+/, "");
  if (token.length === 1) return true; // an initial: "J. Rowling"
  if (token.includes(".")) {
    // "e.g", "p.ej", "EE.UU", "a.m" — but not a domain like "ejemplo.com".
    const parts = token.split(".").filter(Boolean);
    if (parts.every((part) => part.length <= 3)) return true;
  }
  return ABBREVIATIONS.has(token.toLowerCase());
}

const PAIRS: ReadonlyArray<readonly [string, string]> = [
  ["(", ")"],
  ["[", "]"],
  ["«", "»"],
  ["“", "”"],
  ["¿", "?"],
  ["¡", "!"]
];

function count(text: string, needle: string): number {
  let n = 0;
  for (let i = text.indexOf(needle); i !== -1; i = text.indexOf(needle, i + needle.length)) n++;
  return n;
}

/** No cut while a code span, bold, quote, bracket or ¿/¡ is still open. */
function isBalanced(text: string): boolean {
  if (count(text, "`") % 2 !== 0) return false;
  if (count(text, "**") % 2 !== 0) return false;
  if (count(text, '"') % 2 !== 0) return false;
  return PAIRS.every(([open, close]) => count(text, open) <= count(text, close));
}

const TERMINATOR_RUN = /[.!?…]+/g;
const EMOJI = String.raw`(?:\p{Extended_Pictographic}|\p{Regional_Indicator})[\p{Extended_Pictographic}\p{Regional_Indicator}\u{FE0F}\u{200D}\u{20E3}\u{1F3FB}-\u{1F3FF}]*`;
/**
 * What may follow a sentence terminator for the cut to be final: closing
 * marks, emoji that belong to the sentence, then whitespace (at most one line
 * break) and the visible start of the next sentence — an uppercase letter or
 * ¿/¡, optionally behind an opening quote, bracket or emphasis marker.
 */
const AFTER_TERMINATOR = new RegExp(
  String.raw`[”"»’')\]*_\x60]*(?:[ \t]*${EMOJI})*(?:[ \t]+\r?\n?[ \t]*|[ \t]*\r?\n[ \t]*)(?=[“"«‘'(*_]*[\p{Lu}¿¡])`,
  "uy"
);

function sentenceCandidates(text: string, start: number, end: number): Candidate[] {
  const range = text.slice(start, end);
  const out: Candidate[] = [];
  for (const m of range.matchAll(TERMINATOR_RUN)) {
    const run = m[0];
    const at = m.index;
    if (run.includes("…") || run.includes("..")) continue; // ellipsis: a pause, not an end
    if (!/[!?]/.test(run) && isAbbreviation(range.slice(0, at))) continue;
    AFTER_TERMINATOR.lastIndex = at + run.length;
    const after = AFTER_TERMINATOR.exec(range);
    if (!after) continue;
    const next = at + run.length + after[0].length;
    if (!isBalanced(range.slice(0, next))) continue;
    out.push({ offset: start + next, minChars: REPLY_SEGMENT_LONG_CHARS });
  }
  return out;
}

function findCandidates(text: string): Candidate[] {
  const candidates: Candidate[] = [];
  const chunks: Chunk[] = [];
  let chunk: Chunk | null = null;
  let fence: string | null = null;
  let inMath = false;
  let sawBlank = false;

  for (let pos = 0; pos <= text.length; ) {
    const nl = text.indexOf("\n", pos);
    const lineEnd = nl === -1 ? text.length : nl;
    const line = text.slice(pos, lineEnd);
    const inBlock = fence !== null || inMath;

    if (!inBlock && line.trim() === "") {
      if (chunk) sawBlank = true;
    } else {
      let kind: LineKind;
      if (fence !== null) {
        kind = "code";
        if (isFenceClose(line, fence)) fence = null;
      } else if (inMath) {
        kind = "code";
        if (MATH_FENCE.test(line)) inMath = false;
      } else {
        kind = classify(line);
        if (kind === "fence") fence = (FENCE_OPEN.exec(line) as RegExpExecArray)[1];
        if (kind === "math") inMath = true;
      }

      if (!chunk || sawBlank) {
        if (chunk && paragraphCutAllowed(chunk, line)) {
          candidates.push({ offset: pos, minChars: REPLY_SEGMENT_MIN_CHARS });
        }
        chunk = {
          start: pos,
          end: lineEnd,
          firstKind: kind,
          listy: false,
          lastLine: line,
          lastKind: kind,
          proseEnd: kind === "prose" ? null : pos
        };
        chunks.push(chunk);
        sawBlank = false;
      } else if (chunk.proseEnd === null && kind !== "prose") {
        chunk.proseEnd = pos;
      }
      chunk.end = lineEnd;
      chunk.lastLine = line;
      chunk.lastKind = kind;
      if (kind === "list") chunk.listy = true;
    }

    if (nl === -1) break;
    pos = nl + 1;
  }

  for (const c of chunks) {
    if (c.firstKind !== "prose") continue;
    candidates.push(...sentenceCandidates(text, c.start, c.proseEnd ?? c.end));
  }
  return candidates.sort((a, b) => a.offset - b.offset);
}

/**
 * Splits `text` into at most REPLY_SEGMENT_MAX trimmed markdown segments.
 * Joining them back (with the whitespace that separated them) gives the
 * original reply; an empty reply gives no segment.
 */
export function segmentReply(text: string): string[] {
  const segments: string[] = [];
  let start = 0;
  for (const candidate of findCandidates(text)) {
    if (segments.length >= REPLY_SEGMENT_MAX - 1) break;
    const piece = text.slice(start, candidate.offset).trim();
    if (piece.length < candidate.minChars) continue;
    segments.push(piece);
    start = candidate.offset;
  }
  const tail = text.slice(start).trim();
  if (tail) segments.push(tail);
  return segments;
}
