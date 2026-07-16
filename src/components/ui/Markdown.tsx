import { memo } from "react";
import ReactMarkdown from "react-markdown";
import type { Components } from "react-markdown";
import remarkGfm from "remark-gfm";

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
      className="mono overflow-x-auto rounded-md border border-border-soft bg-surface-2 p-3 text-xs"
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
  return (
    <div className="oc-md min-w-0 space-y-2 text-sm leading-relaxed">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
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
