"use client";

import { useEffect } from "react";

export function SmoothScrollProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    let cancelled = false;
    let cleanup: (() => void) | undefined;

    const start = async () => {
      const { default: Lenis } = await import("lenis");
      if (cancelled) return;

      const lenis = new Lenis({
        duration: 1.15,
        easing: (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
        wheelMultiplier: 1,
        touchMultiplier: 1.4,
        lerp: 0.1,
      });

      let rafId = requestAnimationFrame(function raf(time) {
        lenis.raf(time);
        rafId = requestAnimationFrame(raf);
      });

      const onAnchorClick = (event: MouseEvent) => {
        if (event.button !== 0 || event.metaKey || event.ctrlKey) return;
        const anchor = (event.target as Element | null)?.closest(
          'a[href^="#"]'
        ) as HTMLAnchorElement | null;
        if (!anchor) return;
        const hash = anchor.getAttribute("href");
        if (!hash || hash === "#") return;
        const target = document.querySelector(hash);
        if (!target) return;
        event.preventDefault();
        event.stopPropagation();
        lenis.scrollTo(target as HTMLElement, { offset: -64 });
        history.pushState(null, "", hash);
      };
      document.addEventListener("click", onAnchorClick, { capture: true });

      cleanup = () => {
        cancelAnimationFrame(rafId);
        document.removeEventListener("click", onAnchorClick, { capture: true });
        lenis.destroy();
      };
    };

    const schedule =
      typeof requestIdleCallback === "function"
        ? (cb: () => void) => requestIdleCallback(cb, { timeout: 500 })
        : (cb: () => void) => setTimeout(cb, 0);
    const cancel =
      typeof cancelIdleCallback === "function"
        ? (id: number) => cancelIdleCallback(id)
        : (id: number) => clearTimeout(id);

    const handle = schedule(() => void start());

    return () => {
      cancelled = true;
      cancel(handle as number);
      cleanup?.();
    };
  }, []);

  return <>{children}</>;
}
