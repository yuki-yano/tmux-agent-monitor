import { forwardRef, type InputHTMLAttributes } from "react";

import { cn } from "@/lib/cn";

type InputProps = InputHTMLAttributes<HTMLInputElement>;

const Input = forwardRef<HTMLInputElement, InputProps>(({ className, ...props }, ref) => {
  return (
    <input
      ref={ref}
      className={cn(
        "border-latte-surface2 text-latte-text focus:border-latte-lavender focus:ring-latte-lavender/30 w-full rounded-2xl border bg-white/70 px-4 py-2 text-base shadow-sm outline-none transition focus:ring-2 md:text-sm",
        className,
      )}
      {...props}
    />
  );
});

Input.displayName = "Input";

export { Input };
