import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { COLLECTIONS } from "@/lib/generator-options";

// Four preview image URLs per collection for the Generator's picker cards.
// Public library data; cached hard since the library only changes on ingest.
export async function GET() {
  const supabase = await createClient();
  const entries = await Promise.all(
    COLLECTIONS.map(async (c) => {
      const { data } = await supabase
        .from("library_images")
        .select("url")
        .eq("collection", c.id)
        .limit(4);
      return [c.id, (data ?? []).map((r) => r.url)] as const;
    }),
  );
  return NextResponse.json(Object.fromEntries(entries), {
    headers: { "Cache-Control": "public, max-age=3600, stale-while-revalidate=86400" },
  });
}
