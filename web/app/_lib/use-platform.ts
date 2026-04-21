"use client";

import { useEffect, useState } from "react";

export type Platform = "mac" | "windows" | "linux" | "other";

export function usePlatform(): Platform | null {
  const [platform, setPlatform] = useState<Platform | null>(null);

  useEffect(() => {
    setPlatform(detectPlatform());
  }, []);

  return platform;
}

function detectPlatform(): Platform {
  const nav = typeof navigator !== "undefined" ? navigator : undefined;
  if (!nav) return "other";

  const uaData = (
    nav as Navigator & { userAgentData?: { platform?: string } }
  ).userAgentData;
  const source = (uaData?.platform ?? nav.userAgent ?? "").toLowerCase();

  if (/mac|darwin|iphone|ipad|ipod/.test(source)) return "mac";
  if (/win/.test(source)) return "windows";
  if (/linux|x11|cros/.test(source)) return "linux";
  return "other";
}
