import { cn } from "@/lib/utils";

export function Card({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("panel-surface rounded-[28px]", className)}>
      {children}
    </div>
  );
}
