import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  transpilePackages: ["@tetsifymaps/core"],
  turbopack: {
    root: path.resolve(__dirname, "../../"),
  },
  webpack: (config) => {
    // Required for maplibre-gl 6.x Web Worker bundling
    config.resolve.alias = {
      ...config.resolve.alias,
      "maplibre-gl": path.resolve(
        __dirname,
        "node_modules/maplibre-gl/dist/maplibre-gl.mjs"
      ),
    };
    return config;
  },
};

export default nextConfig;
