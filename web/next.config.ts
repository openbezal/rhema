import type { NextConfig } from "next";
import { fileURLToPath } from "node:url";

const nextConfig: NextConfig = {
  output: "export",
  trailingSlash: true,
  turbopack: {
    root: fileURLToPath(new URL(".", import.meta.url)),
  },
  experimental: {
    optimizePackageImports: ["@tabler/icons-react"],
  },
};

export default nextConfig;
