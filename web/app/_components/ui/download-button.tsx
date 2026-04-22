"use client";

import {
  IconBrandApple,
  IconBrandWindows,
  IconDownload,
  type Icon as TablerIcon,
} from "@tabler/icons-react";
import { Button } from "./button";
import { usePlatform } from "../../_lib/use-platform";
import { SITE } from "../../_lib/site";

const COPY: Record<
  "mac" | "windows" | "linux" | "other" | "default",
  { label: string; icon: TablerIcon }
> = {
  mac: { label: "Download for macOS", icon: IconBrandApple },
  windows: { label: "Download for Windows", icon: IconBrandWindows },
  linux: { label: "Download", icon: IconDownload },
  other: { label: "Download", icon: IconDownload },
  default: { label: "Download", icon: IconDownload },
};

export function DownloadButton({
  size = "md",
  className,
}: {
  size?: "md" | "lg";
  className?: string;
}) {
  const platform = usePlatform();
  const copy = COPY[platform ?? "default"];
  const Icon = copy.icon;

  return (
    <Button
      href={SITE.repo.releasesLatest}
      variant="primary"
      size={size}
      className={className}
    >
      <Icon size={16} aria-hidden stroke={2} />
      <span suppressHydrationWarning>{copy.label}</span>
    </Button>
  );
}
