import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Allow the dev server to serve HMR + JS chunks to other devices on the
  // local network. Without this, Next.js blocks cross-origin requests from
  // 192.168.x.x phones/tablets, leaving them with broken interactivity
  // (the page renders but client JS doesn't hydrate properly).
  allowedDevOrigins: ['192.168.0.106'],
};

export default nextConfig;