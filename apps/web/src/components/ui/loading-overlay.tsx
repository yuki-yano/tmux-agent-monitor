import { cva } from "class-variance-authority";
import type { HTMLAttributes } from "react";

import { cn } from "@/lib/cn";

import { Spinner } from "./spinner";

const overlayVariants = cva(
  "bg-latte-base/70 absolute inset-0 z-10 flex flex-col items-center justify-center rounded-2xl backdrop-blur-xs",
  {
    variants: {
      size: {
        sm: "gap-2",
        md: "gap-3",
      },
      blocking: {
        true: "",
        false: "pointer-events-none",
      },
      entrance: {
        immediate: "animate-fade-in",
        delayed: "animate-delayed-fade-in",
      },
    },
    defaultVariants: {
      size: "md",
      blocking: true,
      entrance: "immediate",
    },
  },
);

type LoadingOverlayProps = HTMLAttributes<HTMLDivElement> & {
  label?: string;
  size?: "sm" | "md";
  blocking?: boolean;
  entrance?: "immediate" | "delayed";
};

const LoadingOverlay = ({
  className,
  label = "Loading...",
  size,
  blocking = true,
  entrance,
  ...props
}: LoadingOverlayProps) => {
  return (
    <div className={cn(overlayVariants({ size, blocking, entrance }), className)} {...props}>
      <Spinner size={size === "sm" ? "sm" : "md"} />
      {label && <span className="text-latte-subtext0 text-xs font-medium">{label}</span>}
    </div>
  );
};

export { LoadingOverlay };
