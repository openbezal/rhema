import type { NextConfig } from "next";
import { fileURLToPath } from "node:url";
import { createMDX } from "fumadocs-mdx/next";

const nextConfig: NextConfig = {
  output: "export",
  trailingSlash: true,
  // The default next/image loader requires a server runtime; with
  // output: "export" we ship every image through the static pipeline,
  // so disable the optimizer and let the browser fetch assets as-is.
  images: { unoptimized: true },
  turbopack: {
    root: fileURLToPath(new URL(".", import.meta.url)),
  },
  experimental: {
    optimizePackageImports: ["@tabler/icons-react", "lucide-react"],
  },
};

const withMDX = createMDX();

export default withMDX(nextConfig);
