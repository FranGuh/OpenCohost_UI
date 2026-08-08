import { memo } from "react";
import ReactMarkdown from "react-markdown";
import type { Components } from "react-markdown";
import remarkGfm from "remark-gfm";

/* ------------------------------------------------------------------ */
/*  remarkMathAsCode — $...$ / $$...$$ spans -> inline code            */
/*                                                                     */
/*  No math renderer is installed (KaTeX is a deliberate follow-up     */
/*  decision, not a silent dependency add). Until then a LaTeX span in */
/*  a Kira reply rendered as garbled prose — "$\vec{v}$" mid-sentence  */
/*  (runtime session 2026-08-07, 15:40). This mdast pass wraps each    */
/*  span in an inlineCode node so it lands in the existing styled      */
/*  <code> instead. Only `text` nodes are visited, so fenced blocks    */
/*  and real inline code (value-only nodes, no children) are immune.   */
/* ------------------------------------------------------------------ */

/** Minimal structural mdast shape — @types/mdast is not a direct dep and
 * pnpm's isolated node_modules keeps transitive types un-importable. */
interface MdNode {
  type: string;
  value?: string;
  children?: MdNode[];
}

// $$...$$ first so a display span isn't half-eaten by the inline branch.
// The inline branch demands a non-space char at both edges, so dollar
// amounts ("cuesta $100 y $200") and truncated fragments ("$P(w_n") stay
// plain text. ponytail: heuristic, not a TeX parser — KaTeX is the upgrade.
const MATH_SPAN = /\$\$([^$\n]+?)\$\$|\$(\S(?:[^$\n]*?\S)?)\$/g;

function splitMathSpans(node: MdNode): MdNode[] {
  const text = node.value ?? "";
  const out: MdNode[] = [];
  let cursor = 0;
  for (const match of text.matchAll(MATH_SPAN)) {
    const formula = match[1] ?? match[2];
    if (match.index > cursor) out.push({ type: "text", value: text.slice(cursor, match.index) });
    out.push({ type: "inlineCode", value: formula });
    cursor = match.index + match[0].length;
  }
  if (out.length === 0) return [node]; // no spans — keep the original node untouched
  if (cursor < text.length) out.push({ type: "text", value: text.slice(cursor) });
  return out;
}

function remarkMathAsCode() {
  return (tree: MdNode) => {
    const walk = (node: MdNode) => {
      if (!node.children) return;
      node.children = node.children.flatMap((child) => {
        if (child.type === "text") return splitMathSpans(child);
        walk(child);
        return [child];
      });
    };
    walk(tree);
  };
}

// Cockpit-styled markdown for Kira/assistant chat turns. Deliberately NO
// rehype-raw: raw HTML in a reply stays escaped text (react-markdown's default),
// so an LLM reply can never inject markup into the operator's cockpit. Inline
// code is styled in styles.css (.oc-md :not(pre) > code) — the single robust way
// to tell inline code from a fenced block without double-styling the <pre>.
const COMPONENTS: Components = {
  a: ({ node, ...props }) => (
    <a
      {...props}
      target="_blank"
      rel="noreferrer"
      className="text-[var(--kira-cyan)] underline underline-offset-2"
    />
  ),
  ul: ({ node, ...props }) => <ul {...props} className="list-disc space-y-0.5 pl-5" />,
  ol: ({ node, ...props }) => <ol {...props} className="list-decimal space-y-0.5 pl-5" />,
  h1: ({ node, ...props }) => <h1 {...props} className="mt-2 text-sm font-semibold" />,
  h2: ({ node, ...props }) => <h2 {...props} className="mt-2 text-sm font-semibold" />,
  h3: ({ node, ...props }) => <h3 {...props} className="mt-2 text-[13px] font-semibold" />,
  pre: ({ node, ...props }) => (
    <pre
      {...props}
      className="mono overflow-x-auto rounded-md border border-border-soft bg-surface-2 p-3 text-[13px] leading-relaxed"
    />
  ),
  table: ({ node, ...props }) => (
    <div className="overflow-x-auto">
      <table {...props} className="w-full text-xs" />
    </div>
  ),
  th: ({ node, ...props }) => (
    <th {...props} className="border-b border-border px-2 py-1 text-left font-semibold" />
  ),
  td: ({ node, ...props }) => <td {...props} className="border-b border-border-soft px-2 py-1" />
};

/**
 * Renders Kira's LLM markdown (bold, italic, code, tables, lists, headings,
 * links) as calm cockpit elements. Memoized: the transcript re-renders on every
 * reply poll, and re-parsing unchanged markdown each time is pure waste.
 * space-y-2 spaces multiple blocks; a single paragraph gets no extra margin.
 */
function MarkdownImpl({ content }: { content: string }) {
  // text-[15px] (was text-sm/14px) + break-words: owner legibility pass
  // (runtime session 2026-08-07) — bigger chat type, and an unbreakable long
  // token (URL, LaTeX fragment) wraps instead of dragging the bubble wide.
  return (
    <div className="oc-md min-w-0 space-y-2 break-words text-[15px] leading-relaxed">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMathAsCode]}
        components={COMPONENTS}
        // Security hardening (audit 2026-07-15): an LLM reply must never trigger
        // outbound requests from the operator's machine — ![x](https://…) would
        // otherwise render a live <img> (tracking-pixel pattern). The image node
        // is dropped entirely; surrounding text is unaffected.
        disallowedElements={["img"]}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}

export const Markdown = memo(MarkdownImpl);
