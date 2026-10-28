import type { ButtonHTMLAttributes } from "react";
import { Loader2 } from "lucide-react";
import { cn } from "./cn";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md";

const VARIANTS: Record<Variant, string> = {
  primary: "bg-accent-strong text-white hover:brightness-110 disabled:opacity-50",
  secondary: "border border-border bg-surface text-text hover:bg-surface-2 disabled:opacity-50",
  ghost: "text-muted hover:bg-surface-2 hover:text-text disabled:opacity-50",
  danger: "border border-border bg-surface text-bad hover:bg-bad-soft disabled:opacity-50",
};

const SIZES: Record<Size, string> = { sm: "h-8 gap-1.5 px-3 text-sm", md: "h-10 gap-2 px-4 text-sm" };

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  /** Shows a spinner and blocks clicks while a change is being made. */
  loading?: boolean;
}

export function Button({ variant = "secondary", size = "md", loading = false, disabled, className, children, type = "button", ...rest }: Props) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn("inline-flex shrink-0 items-center justify-center rounded-lg font-medium transition disabled:cursor-not-allowed", VARIANTS[variant], SIZES[size], className)}
      {...rest}
    >
      {loading ? <Loader2 aria-hidden className="size-4 animate-spin" /> : null}
      {children}
    </button>
  );
}
