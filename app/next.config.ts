import type { NextConfig } from "next";
import { join } from "node:path";

const nextConfig: NextConfig = {
  transpilePackages: ["@bullstreet/shared"],
  turbopack: { root: join(process.cwd(), "..") },
  outputFileTracingRoot: join(process.cwd(), ".."),
  env: {
    NEXT_PUBLIC_CHAIN_ID: process.env.CHAIN_ID ?? process.env.NEXT_PUBLIC_CHAIN_ID ?? "31337",
  },
};

export default nextConfig;
