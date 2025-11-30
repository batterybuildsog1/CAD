import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  reactCompiler: true,

  // Configure Turbopack (default in Next.js 16+)
  // Empty config enables Turbopack with defaults
  turbopack: {},

  // Allow WASM files to be served from node_modules
  transpilePackages: ["geometry-wasm"],
};

export default nextConfig;
