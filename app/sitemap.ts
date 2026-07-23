import type { MetadataRoute } from "next";
import { listGuides } from "@/lib/guides";

const BASE = process.env.NEXT_PUBLIC_APP_URL || "https://slideshowai-three.vercel.app";

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: BASE, changeFrequency: "weekly", priority: 1 },
    { url: `${BASE}/guides`, changeFrequency: "weekly", priority: 0.8 },
    ...listGuides().map((g) => ({
      url: `${BASE}/guides/${g.slug}`,
      changeFrequency: "monthly" as const,
      priority: 0.7,
    })),
    { url: `${BASE}/privacy`, changeFrequency: "yearly", priority: 0.2 },
    { url: `${BASE}/terms`, changeFrequency: "yearly", priority: 0.2 },
  ];
}
