import { AlertTriangle, CheckCircle, Circle, Clock, Loader2, Sparkles, Zap } from "lucide-react";
import type { HTMLAttributes, ReactNode } from "react";

import { cn } from "@/lib/cn";

type BadgeProps = HTMLAttributes<HTMLSpanElement> & {
  tone?: "running" | "waiting" | "permission" | "shell" | "done" | "unknown" | "codex" | "claude";
  size?: "sm" | "md";
};

const toneClass: Record<NonNullable<BadgeProps["tone"]>, string> = {
  running:
    "bg-latte-green/20 text-latte-green border-latte-green/40 shadow-[0_0_12px_rgb(var(--ctp-green)/0.3)]",
  waiting:
    "bg-latte-peach/20 text-latte-peach border-latte-peach/40 shadow-[0_0_8px_rgb(var(--ctp-peach)/0.25)]",
  permission:
    "bg-latte-red/25 text-latte-red border-latte-red/60 shadow-[0_0_20px_rgb(var(--ctp-red)/0.5)] animate-pulse-attention",
  shell: "bg-latte-blue/15 text-latte-blue border-latte-blue/40",
  done: "bg-latte-blue/15 text-latte-blue border-latte-blue/40",
  unknown: "bg-latte-surface1 text-latte-overlay1 border-latte-overlay0/60",
  codex: "bg-latte-mauve/15 text-latte-mauve border-latte-mauve/40",
  claude: "bg-latte-lavender/15 text-latte-lavender border-latte-lavender/40",
};

const toneIcon: Record<NonNullable<BadgeProps["tone"]>, (className: string) => ReactNode> = {
  running: (className) => <Loader2 className={cn("animate-spin", className)} />,
  waiting: (className) => <Clock className={className} />,
  permission: (className) => <AlertTriangle className={cn("animate-bounce-subtle", className)} />,
  shell: (className) => <Circle className={className} />,
  done: (className) => <CheckCircle className={className} />,
  unknown: (className) => <Circle className={className} />,
  codex: (className) => <Sparkles className={className} />,
  claude: (className) => <Zap className={className} />,
};

const sizeClass = {
  md: "px-3 py-1 text-[11px] tracking-[0.14em]",
  sm: "px-2.5 py-0.5 text-[10px] tracking-[0.12em]",
};

const iconSizeClass = {
  md: "h-3 w-3",
  sm: "h-2.5 w-2.5",
};

const Badge = ({ className, tone = "unknown", size = "md", children, ...props }: BadgeProps) => {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border font-semibold uppercase",
        sizeClass[size],
        toneClass[tone],
        className,
      )}
      {...props}
    >
      {toneIcon[tone](iconSizeClass[size])}
      {children}
    </span>
  );
};

export { Badge };
