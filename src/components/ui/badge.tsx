import { cn } from "@/lib/utils";

export function Badge({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border border-[var(--line)] bg-white/75 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--muted)]",
        className,
      )}
    >
      {children}
    </span>
  );
}
