import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The Sharp compositor embeds Inter TTFs (assets/fonts) into the SVG. Ensure
  // those files are traced into the serverless bundles that composite slides.
  outputFileTracingIncludes: {
    "/*": ["./assets/fonts/**/*"],
  },
  // Dev-only: Next 16 only trusts `localhost` as a dev origin, so loading the
  // dashboard through an ngrok tunnel (needed for the TikTok OAuth flow) gets
  // its /_next/* chunks blocked and the client never hydrates. Trust ngrok's
  // free-tier domains (subdomain rotates each session, hence the wildcard).
  allowedDevOrigins: ["*.ngrok-free.dev", "*.ngrok-free.app", "*.ngrok.io"],
};

export default nextConfig;
