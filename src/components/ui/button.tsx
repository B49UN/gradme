import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cn } from "@/lib/utils";

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  asChild?: boolean;
  variant?: "default" | "secondary" | "ghost" | "outline" | "danger";
  size?: "sm" | "md" | "lg" | "icon";
};

const variants: Record<NonNullable<ButtonProps["variant"]>, string> = {
  default:
    "bg-[var(--foreground)] text-white hover:bg-[color-mix(in_oklab,var(--foreground)_84%,black)]",
  secondary:
    "bg-[var(--accent)] text-white hover:bg-[color-mix(in_oklab,var(--accent)_86%,black)]",
  ghost:
    "bg-transparent text-[var(--foreground)] hover:bg-black/5",
  outline:
    "border border-[var(--line)] bg-white/60 text-[var(--foreground)] hover:bg-white",
  danger:
    "bg-[#a43a2c] text-white hover:bg-[#8d2619]",
};

const sizes: Record<NonNullable<ButtonProps["size"]>, string> = {
  sm: "h-9 rounded-xl px-3 text-sm",
  md: "h-10 rounded-2xl px-4 text-sm",
  lg: "h-11 rounded-2xl px-5 text-sm",
  icon: "h-10 w-10 rounded-2xl p-0",
};

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, asChild, variant = "default", size = "md", ...props }, ref) => {
    const Component = asChild ? Slot : "button";

    return (
      <Component
        ref={ref}
        className={cn(
          "inline-flex items-center justify-center gap-2 whitespace-nowrap font-medium transition disabled:pointer-events-none disabled:opacity-50",
          variants[variant],
          sizes[size],
          className,
        )}
        {...props}
      />
    );
  },
);

Button.displayName = "Button";
