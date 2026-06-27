import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The Sharp compositor embeds Inter TTFs (assets/fonts) into the SVG. Ensure
  // those files are traced into the serverless bundles that composite slides.
  outputFileTracingIncludes: {
    "/*": ["./assets/fonts/**/*"],
  },
};

export default nextConfig;
