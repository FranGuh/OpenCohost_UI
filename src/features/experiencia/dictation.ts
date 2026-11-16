/**
 * PTT dictation into the chat composer (ptt-dictation-20261111).
 *
 * Pure text math, no DOM: the panel captures the composer selection while it
 * is still valid (the textarea blurs when the owner clicks the mic) and hands
 * it here with the dictated words. `selection` null means the composer never
 * had focus, so the words are appended.
 */
export interface ComposerSelection {
  start: number;
  end: number;
}

export interface DictationInsert {
  value: string;
  /** Caret position right after the inserted words. */
  caret: number;
}

// No space is added between the dictated words and closing punctuation.
const NO_SPACE_BEFORE = /^[\s,.;:!?)\]}…]/;

export function insertDictation(value: string, text: string, selection: ComposerSelection | null): DictationInsert {
  const words = text.trim();
  const len = value.length;
  let start = selection ? Math.min(selection.start, selection.end) : len;
  let end = selection ? Math.max(selection.start, selection.end) : len;
  start = Math.max(0, Math.min(start, len));
  end = Math.max(start, Math.min(end, len));
  if (!words) return { value, caret: end };

  const before = value.slice(0, start);
  const after = value.slice(end);
  const lead = before && !/\s$/.test(before) ? " " : "";
  const trail = after && !NO_SPACE_BEFORE.test(after) ? " " : "";
  const head = `${before}${lead}${words}`;
  return { value: `${head}${trail}${after}`, caret: head.length };
}
