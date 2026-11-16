import { memo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import type { Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeKatex from "rehype-katex";
import { Check, Copy } from "lucide-react";
import "katex/dist/katex.min.css";
import { useT } from "../i18n/t.js";
import { cn } from "../lib/cn.js";

/* ------------------------------------------------------------------ */
/*  KaTeX Math & Arrow formatting for Kira/assistant chat turns       */
/*                                                                     */
/*  KaTeX renders mathematical formulas ($...$, $$...$$) accurately    */
/*  and fast. In addition, remarkBareArrows converts unescaped         */
/*  LaTeX sequence arrows outside math mode (e.g. `\rightarrow`) into  */
/*  Unicode arrows (→) so casual logical flows render cleanly even     */
/*  when the model omits math delimiters.                              */
/* ------------------------------------------------------------------ */

interface MdNode {
  type: string;
  value?: string;
  children?: MdNode[];
  data?: {
    hName?: string;
    hProperties?: Record<string, unknown>;
    hChildren?: MdNode[];
  };
}

const MATH_SPAN = /\$\$([^$\n]+?)\$\$|\$([^\s$\n](?:[^$\n]*?[^\s$\n])?)\$/g;
const BARE_ARROW_RE = /\\(?:longrightarrow|rightarrow|to)\b/g;
const BARE_IMPLIES_RE = /\\(?:Longrightarrow|Rightarrow|implies)\b/g;
const BARE_LEFT_ARROW_RE = /\\(?:longleftarrow|leftarrow)\b/g;

function isMathFormula(body: string): boolean {
  const trimmed = body.trim();
  if (!trimmed) return false;
  // If it starts with a digit and has no math operators or TeX syntax, treat as currency ($100, $50 y $20)
  if (/^\d/.test(trimmed) && !/[\\^_{}=+\-*/<>≤≥≠≈±×÷]/.test(trimmed)) {
    return false;
  }
  if (/[\\^_{}]/.test(trimmed)) return true;
  if (/[A-Za-z][A-Za-z0-9]*_[A-Za-z0-9]+/.test(trimmed)) return true;
  if (/\bO\s*\([^$]+\)/.test(trimmed)) return true;
  if (/[A-Za-z0-9]\s*[=+\-*/<>≤≥≠≈±×÷]\s*[A-Za-z0-9]/.test(trimmed)) return true;
  if (/\b[A-Za-z]\s*\([A-Za-z0-9,\s+\-*/]+\)/.test(trimmed)) return true;
  if (/^[A-Za-z](?:[0-9]+)?$/.test(trimmed)) return true;
  return false;
}

function splitMathAndArrowSpans(node: MdNode): MdNode[] {
  const text = node.value ?? "";
  const out: MdNode[] = [];
  let cursor = 0;
  for (const match of text.matchAll(MATH_SPAN)) {
    const isDisplay = match[1] !== undefined;
    const formula = match[1] ?? match[2];
    if (!isDisplay && !isMathFormula(formula)) {
      // Not a math formula (e.g. currency amounts like $100) — keep as text
      continue;
    }
    if (match.index > cursor) {
      out.push({
        type: "text",
        value: text
          .slice(cursor, match.index)
          .replace(BARE_ARROW_RE, "→")
          .replace(BARE_IMPLIES_RE, "⇒")
          .replace(BARE_LEFT_ARROW_RE, "←")
      });
    }
    if (isDisplay) {
      out.push({
        type: "math",
        value: formula,
        data: {
          hName: "div",
          hProperties: { className: ["math", "math-display"] },
          hChildren: [{ type: "text", value: formula }]
        }
      });
    } else {
      out.push({
        type: "inlineMath",
        value: formula,
        data: {
          hName: "span",
          hProperties: { className: ["math", "math-inline"] },
          hChildren: [{ type: "text", value: formula }]
        }
      });
    }
    cursor = match.index + match[0].length;
  }
  if (out.length === 0) {
    const converted = text
      .replace(BARE_ARROW_RE, "→")
      .replace(BARE_IMPLIES_RE, "⇒")
      .replace(BARE_LEFT_ARROW_RE, "←");
    return converted === text ? [node] : [{ ...node, value: converted }];
  }
  if (cursor < text.length) {
    out.push({
      type: "text",
      value: text
        .slice(cursor)
        .replace(BARE_ARROW_RE, "→")
        .replace(BARE_IMPLIES_RE, "⇒")
        .replace(BARE_LEFT_ARROW_RE, "←")
    });
  }
  return out;
}

/**
 * Operator bubbles keep the line breaks the operator typed (CommonMark would
 * collapse a single "\n" into a space). Splits text nodes on "\n" into text +
 * mdast `break` nodes; code, inline code and math are other node types and are
 * left alone. Local on purpose: remark-breaks is not a dependency.
 */
function remarkKeepLineBreaks() {
  return (tree: MdNode) => {
    const walk = (node: MdNode) => {
      if (!node.children) return;
      node.children = node.children.flatMap((child) => {
        if (child.type === "text" && child.value?.includes("\n")) {
          const parts = child.value.split("\n");
          return parts.flatMap((part, i): MdNode[] => {
            const out: MdNode[] = i > 0 ? [{ type: "break" }] : [];
            if (part) out.push({ type: "text", value: part });
            return out;
          });
        }
        walk(child);
        return [child];
      });
    };
    walk(tree);
  };
}

function remarkSmartMath() {
  return (tree: MdNode) => {
    const walk = (node: MdNode) => {
      if (!node.children) return;
      node.children = node.children.flatMap((child) => {
        if (child.type === "text") return splitMathAndArrowSpans(child);
        walk(child);
        return [child];
      });
    };
    walk(tree);
  };
}

/**
 * T7: a copy control on every fenced code block (Kira's replies render
 * Markdown, so a per-message copy alone would still leave a multi-line code
 * block requiring manual selection). Reads the block's own rendered text via
 * a ref instead of re-serializing the mdast/hast `node` — the DOM text is
 * exactly what the operator sees and needs, byte for byte.
 *
 * Calls `useT()` itself (its own hook subscription) rather than receiving a
 * translated label from the memoized `Markdown` component above: `Markdown`
 * is memoized on `content` alone, so a label baked in there would freeze on
 * a locale flip that doesn't also change the message text (the exact defect
 * `t.ts`'s own history already fixed once for `useT()` itself).
 */
function CodeBlock({ node, ...props }: JSX.IntrinsicElements["pre"] & { node?: unknown }) {
  const t = useT();
  const preRef = useRef<HTMLPreElement>(null);
  const [copied, setCopied] = useState(false);

  function handleCopy() {
    const text = preRef.current?.textContent ?? "";
    if (!text) return;
    void navigator.clipboard?.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="group relative">
      <pre
        {...props}
        ref={preRef}
        className="mono overflow-x-auto rounded-md border border-border-soft bg-surface-2 p-3 pr-9 text-[13px] leading-relaxed"
      />
      <button
        type="button"
        onClick={handleCopy}
        aria-label={copied ? t("ui.markdown.copied") : t("ui.markdown.copyCode")}
        title={copied ? t("ui.markdown.copied") : t("ui.markdown.copyCode")}
        className={cn(
          "absolute right-1.5 top-1.5 inline-flex items-center justify-center rounded-md border border-border-soft/70 bg-card/90 p-1 text-muted-foreground opacity-0 transition-opacity",
          "hover:text-foreground focus-visible:opacity-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
          "group-hover:opacity-100 group-focus-within:opacity-100",
          copied && "text-ok opacity-100"
        )}
      >
        {copied ? <Check size={12} aria-hidden="true" /> : <Copy size={12} aria-hidden="true" />}
      </button>
    </div>
  );
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
  pre: CodeBlock,
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
function MarkdownImpl({ content, breaks = false }: { content: string; breaks?: boolean }) {
  // text-[15px] (was text-sm/14px) + break-words: owner legibility pass
  // (runtime session 2026-08-07) — bigger chat type, and an unbreakable long
  // token (URL, LaTeX fragment) wraps instead of dragging the bubble wide.
  return (
    <div className="oc-md min-w-0 space-y-2 break-words text-[15px] leading-relaxed">
      <ReactMarkdown
        remarkPlugins={breaks ? [remarkGfm, remarkSmartMath, remarkKeepLineBreaks] : [remarkGfm, remarkSmartMath]}
        rehypePlugins={[[rehypeKatex, { strict: false, throwOnError: false }]]}
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
