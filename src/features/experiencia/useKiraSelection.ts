import { useEffect, useState } from "react";

/** Attribute that marks the rendered text of one Kira reply. */
export const KIRA_TURN_ATTR = "data-kira-turn";

function turnOf(node: Node | null): Element | null {
  const el = node instanceof Element ? node : (node?.parentElement ?? null);
  return el?.closest(`[${KIRA_TURN_ATTR}]`) ?? null;
}

/** Trimmed selected text when the whole selection sits inside ONE Kira turn, else null.
 * A selection that touches anything outside a single turn is ignored (simplest robust option). */
export function readKiraSelection(): string | null {
  const sel = typeof window !== "undefined" ? window.getSelection() : null;
  if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return null;
  const range = sel.getRangeAt(0);
  const start = turnOf(range.startContainer);
  const end = turnOf(range.endContainer);
  if (!start || start !== end) return null;
  const text = sel.toString().trim();
  return text.length > 0 ? text : null;
}

/** Tracks the current in-turn Kira selection. The text lives in state only; it is never logged. */
export function useKiraSelection(): { text: string | null; clear: () => void } {
  const [text, setText] = useState<string | null>(null);

  useEffect(() => {
    const update = () => setText(readKiraSelection());
    document.addEventListener("selectionchange", update);
    document.addEventListener("mouseup", update);
    document.addEventListener("keyup", update);
    return () => {
      document.removeEventListener("selectionchange", update);
      document.removeEventListener("mouseup", update);
      document.removeEventListener("keyup", update);
    };
  }, []);

  return { text, clear: () => setText(null) };
}
