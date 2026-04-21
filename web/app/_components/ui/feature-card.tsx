import type { Icon as TablerIcon } from "@tabler/icons-react";
import { cn } from "../../_lib/utils";

export function FeatureCard({
  icon: Icon,
  title,
  body,
  emphasize,
  className,
}: {
  icon: TablerIcon;
  title: string;
  body: string;
  emphasize?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "relative flex flex-col items-center gap-4 border border-border p-8 text-center transition-colors duration-300 md:p-10",
        emphasize ? "bg-surface" : "bg-background",
        "hover:bg-surface",
        className
      )}
    >
      <Icon
        size={32}
        stroke={1.75}
        aria-hidden
        className="shrink-0 text-foreground"
      />
      <div className="flex flex-col gap-2">
        <h3 className="text-lg font-medium leading-6 tracking-[-0.01em] text-foreground">
          {title}
        </h3>
        <p className="text-lg leading-6 tracking-[-0.01em] text-muted-foreground">
          {body}
        </p>
      </div>
    </div>
  );
}
