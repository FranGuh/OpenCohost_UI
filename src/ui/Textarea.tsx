import { useLayoutEffect, useRef } from "react";
import type { ReactNode, TextareaHTMLAttributes } from "react";
import { cn } from "../lib/cn.js";
import { FIELD_BASE_CLASSES, FIELD_WRAPPER_CLASSES } from "./Input.js";

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  /** Optional node rendered inside the field wrapper, trailing the textarea. */
  trailing?: ReactNode;
  /** Wrapper className - applied to the outer container when `trailing` is used. */
  wrapperClassName?: string;
}

/**
 * Auto-growing textarea that looks exactly like `Input` while it holds one line.
 *
 * `min-h-11` + `py-[11px]` reproduce Input's `h-11` box for a single 20px line
 * (44 = 2 border + 22 padding + 20 line). Height follows content up to
 * `max-h-36` (about 6 lines), then the field scrolls internally.
 */
export function Textarea({ trailing, className, wrapperClassName, rows = 1, ...props }: TextareaProps) {
  const ref = useRef<HTMLTextAreaElement>(null);

  // Re-measure on every render: the value may be controlled and cleared after a send.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    // scrollHeight is 0 where layout is unavailable (jsdom); keep the CSS floor then.
    if (el.scrollHeight > 0) el.style.height = `${el.scrollHeight}px`;
  });

  const fieldClasses = cn(
    "min-h-11 max-h-36 resize-none overflow-y-auto py-[11px] leading-5",
    FIELD_BASE_CLASSES,
    trailing && "rounded-r-none border-r-0",
    className
  );

  if (!trailing) {
    return <textarea {...props} ref={ref} rows={rows} className={fieldClasses} />;
  }

  return (
    <div className={cn(FIELD_WRAPPER_CLASSES, wrapperClassName)}>
      <textarea {...props} ref={ref} rows={rows} className={fieldClasses} />
      {trailing}
    </div>
  );
}
