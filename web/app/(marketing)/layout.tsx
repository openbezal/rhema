import type { ReactNode } from "react";
import { SmoothScrollProvider } from "../_components/ui/smooth-scroll-provider";

export default function MarketingLayout({ children }: { children: ReactNode }) {
  return <SmoothScrollProvider>{children}</SmoothScrollProvider>;
}
