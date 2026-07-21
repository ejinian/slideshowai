import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Keep native-binary packages out of the webpack bundle so their platform
  // .node binaries are required at runtime + traced onto Vercel (Linux).
  serverExternalPackages: ["@resvg/resvg-js", "sharp"],
  // The Sharp compositor embeds Inter TTFs (assets/fonts) into the SVG. Ensure
  // those files are traced into the serverless bundles that composite slides.
  // Use "**" so ALL routes are covered — the on-demand renderer runs in several
  // deeply-nested API routes (/api/slideshows/[id]/render/[pos], /api/tiktok/img/…,
  // /api/slideshows/[id]/zip); a shallow "/*" glob misses them → tofu glyphs.
  outputFileTracingIncludes: {
    "**": ["./assets/fonts/**/*"],
    // Guide markdown is read via fs (lib/guides.ts). Pages are fully static,
    // but trace the files anyway so any future dynamic read can't 404 on Vercel.
    "/guides/**": ["./content/guides/**/*"],
  },
  // Dev-only: Next 16 only trusts `localhost` as a dev origin, so loading the
  // dashboard through an ngrok tunnel (needed for the TikTok OAuth flow) gets
  // its /_next/* chunks blocked and the client never hydrates. Trust ngrok's
  // free-tier domains (subdomain rotates each session, hence the wildcard).
  allowedDevOrigins: ["*.ngrok-free.dev", "*.ngrok-free.app", "*.ngrok.io"],
};

export default nextConfig;
