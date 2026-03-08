import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["better-sqlite3", "keytar", "@napi-rs/canvas", "pdfjs-dist"],
};

export default nextConfig;
