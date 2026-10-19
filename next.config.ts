import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // ffmpeg-static locates its binary relative to its own folder, so it must not be bundled.
  serverExternalPackages: ["ffmpeg-static"],
  // Keep the dev overlay badge out of the way of the editor UI.
  devIndicators: false,
  // We maintain our own AGENTS.md (a copy of CLAUDE.md); don't let `next dev` add to it.
  agentRules: false,
};

export default nextConfig;
