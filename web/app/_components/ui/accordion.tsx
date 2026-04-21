"use client";

import { useEffect, useId, useRef, useState } from "react";
import { IconChevronDown } from "@tabler/icons-react";
import { cn } from "../../_lib/utils";

type Item = {
  id?: string;
  question: string;
  answer: React.ReactNode;
};

export function Accordion({
  items,
  className,
}: {
  items: Item[];
  className?: string;
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  const baseId = useId();

  return (
    <div className={cn("w-full", className)}>
      {items.map((item, i) => {
        const id = item.id ?? `${baseId}-${i}`;
        const isOpen = openId === id;
        return (
          <AccordionItem
            key={id}
            id={id}
            item={item}
            isOpen={isOpen}
            isLast={i === items.length - 1}
            onToggle={() => setOpenId(isOpen ? null : id)}
          />
        );
      })}
    </div>
  );
}

function AccordionItem({
  id,
  item,
  isOpen,
  isLast,
  onToggle,
}: {
  id: string;
  item: Item;
  isOpen: boolean;
  isLast: boolean;
  onToggle: () => void;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState(0);

  useEffect(() => {
    if (!panelRef.current) return;
    const ro = new ResizeObserver(() => {
      if (panelRef.current) setHeight(panelRef.current.scrollHeight);
    });
    ro.observe(panelRef.current);
    setHeight(panelRef.current.scrollHeight);
    return () => ro.disconnect();
  }, []);

  return (
    <div
      className={cn(
        "border-t border-border-strong",
        isLast && "border-b"
      )}
    >
      <h3>
        <button
          type="button"
          id={`${id}-trigger`}
          aria-expanded={isOpen}
          aria-controls={`${id}-panel`}
          onClick={onToggle}
          className="group flex w-full items-center justify-between gap-6 py-6 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 rounded-sm"
        >
          <span className="text-xl leading-[32px] tracking-[-0.01em] text-foreground font-medium md:text-2xl">
            {item.question}
          </span>
          <IconChevronDown
            size={24}
            aria-hidden
            className={cn(
              "shrink-0 text-muted-foreground transition-transform duration-300 ease-out",
              isOpen && "rotate-180 text-foreground"
            )}
          />
        </button>
      </h3>
      <div
        id={`${id}-panel`}
        role="region"
        aria-labelledby={`${id}-trigger`}
        style={{ height: isOpen ? height : 0 }}
        className="overflow-hidden transition-[height] duration-300 ease-out motion-reduce:transition-none"
      >
        <div ref={panelRef} className="pb-6 pr-10">
          <div className="text-[17px] leading-6 tracking-[-0.01em] text-muted-foreground">
            {item.answer}
          </div>
        </div>
      </div>
    </div>
  );
}
