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

      cleanup = () => {
        cancelAnimationFrame(rafId);
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
