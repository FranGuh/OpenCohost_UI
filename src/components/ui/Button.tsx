import type { ButtonHTMLAttributes } from "react";
import { cn } from "../../lib/cn.js";

export type ButtonVariant = "primary" | "outline" | "ghost";

const variantClasses: Record<ButtonVariant, string> = {
  // gradient accent surface — mirrors the mockup's active/primary treatment
  primary: "bg-[image:var(--accent-grad)] text-primary-foreground border-transparent",
  outline: "bg-card text-foreground border-border hover:border-primary",
  ghost: "bg-transparent text-muted-foreground border-transparent hover:text-foreground"
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
}

export function Button({ variant = "outline", className, ...props }: ButtonProps) {
  return (
    <button
      className={cn(
        "inline-flex h-9 items-center justify-center gap-2 rounded-md border px-4 text-sm font-semibold transition-colors duration-fast ease-io",
        "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
        variantClasses[variant],
        className
      )}
      {...props}
    />
  );
}
