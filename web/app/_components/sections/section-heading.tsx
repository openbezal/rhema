import { cn } from "../../_lib/utils";

export function SectionHeading({
  children,
  subtitle,
  className,
  align = "left",
  id,
}: {
  children: React.ReactNode;
  subtitle?: React.ReactNode;
  className?: string;
  align?: "left" | "center";
  id?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col gap-3",
        align === "center" ? "items-center text-center" : "items-start",
        className
      )}
    >
      <h2
        id={id}
        className={cn(
          "font-medium text-foreground",
          "text-4xl leading-[1.05] tracking-[-0.035em] sm:text-5xl md:text-6xl lg:text-[62px] lg:tracking-[-0.05em]"
        )}
      >
        {children}
      </h2>
      {subtitle && (
        <p className="max-w-[1080px] text-lg leading-8 text-muted-foreground lg:text-2xl">
          {subtitle}
        </p>
      )}
    </div>
  );
}
