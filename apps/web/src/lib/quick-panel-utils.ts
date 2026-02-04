import { AlertTriangle, Circle, Clock, Loader2, Sparkles, Zap } from "lucide-react";
import type { ComponentType } from "react";

export type IconMeta = {
  icon: ComponentType<{ className?: string }>;
  className: string;
  wrap: string;
  label: string;
};

export const formatRepoDirLabel = (value: string | null) => {
  if (!value) return "No repo";
  const trimmed = value.replace(/\/+$/, "");
  if (!trimmed) return "No repo";
  const parts = trimmed.split("/");
  const last = parts[parts.length - 1] ?? trimmed;
  return last || trimmed;
};

export const statusIconMeta = (state: string): IconMeta => {
  switch (state) {
    case "WAITING_PERMISSION":
      return {
        icon: AlertTriangle,
        className: "text-latte-red",
        wrap: "border-latte-red/40 bg-latte-red/15",
        label: "WAITING_PERMISSION",
      };
    case "WAITING_INPUT":
      return {
        icon: Clock,
        className: "text-latte-peach",
        wrap: "border-latte-peach/40 bg-latte-peach/15",
        label: "WAITING_INPUT",
      };
    case "RUNNING":
      return {
        icon: Loader2,
        className: "text-latte-green animate-spin",
        wrap: "border-latte-green/40 bg-latte-green/10",
        label: "RUNNING",
      };
    case "SHELL":
      return {
        icon: Circle,
        className: "text-latte-blue",
        wrap: "border-latte-blue/40 bg-latte-blue/10",
        label: "SHELL",
      };
    default:
      return {
        icon: Circle,
        className: "text-latte-overlay1",
        wrap: "border-latte-surface2/60 bg-latte-crust/60",
        label: "UNKNOWN",
      };
  }
};

export const agentIconMeta = (agent: string | null | undefined): IconMeta => {
  switch (agent) {
    case "codex":
      return {
        icon: Sparkles,
        className: "text-latte-mauve",
        wrap: "border-latte-mauve/40 bg-latte-mauve/10",
        label: "CODEX",
      };
    case "claude":
      return {
        icon: Zap,
        className: "text-latte-lavender",
        wrap: "border-latte-lavender/40 bg-latte-lavender/10",
        label: "CLAUDE",
      };
    default:
      return {
        icon: Circle,
        className: "text-latte-overlay1",
        wrap: "border-latte-surface2/60 bg-latte-crust/60",
        label: "UNKNOWN",
      };
  }
};
