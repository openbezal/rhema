import { cn } from "../../_lib/utils";

export function Container({
  className,
  children,
  as: Tag = "div",
}: {
  className?: string;
  children: React.ReactNode;
  as?: "div" | "section" | "header" | "footer" | "main" | "nav";
}) {
  return (
    <Tag
      className={cn(
        "mx-auto w-full max-w-[1440px] px-5 sm:px-8 lg:px-20 xl:px-[140px]",
        className
      )}
    >
      {children}
    </Tag>
  );
}
