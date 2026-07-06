import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/utils/supabase/server";
import { SlideshowDetail } from "@/components/dashboard/slideshows/SlideshowDetail";

export const dynamic = "force-dynamic";

interface SlideRow {
  position: number;
  role: string | null;
  number: number | null;
  caption: string | null;
  storage_path: string | null;
  position_x: number | null;
  position_y: number | null;
  align: string | null;
  max_width: number | null;
}

// Slide storage_path is an `{i}.jpg` identifier; the text-free background the
// editor overlays live text on lives at `{i}-bg.jpg`. Handle both .jpg and legacy
// .png, and paths already pointing at the background.
const bgPathFor = (p: string) =>
  p.endsWith("-bg.jpg") ? p : p.replace(/\.(png|jpe?g)$/i, "-bg.jpg");

export default async function SlideshowDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/dashboard/slideshows");

  const { data: ss } = await supabase
    .from("slideshows")
    .select("id, title, niche, status, created_at")
    .eq("id", id)
    .single();
  if (!ss) notFound();

  const { data: tiktokConn } = await supabase
    .from("tiktok_connections")
    .select("id")
    .eq("user_id", user.id)
    .maybeSingle();
  const isTikTokConnected = !!tiktokConn;

  const { data: slideRows } = await supabase
    .from("slides")
    .select(
      "position, role, number, caption, storage_path, position_x, position_y, align, max_width",
    )
    .eq("slideshow_id", id)
    .order("position", { ascending: true });
  const rows = (slideRows ?? []) as SlideRow[];

  const bgPaths = rows
    .map((r) => r.storage_path)
    .filter((p): p is string => Boolean(p))
    .map(bgPathFor);
  // Sign the text-free backgrounds — the editor overlays live HTML text on them.
  // Missing bg objects just yield "" (→ the "regenerate" hint).
  const { data: signed } = await supabase.storage
    .from("slideshows")
    .createSignedUrls(bgPaths, 3600);
  const urlByPath = new Map((signed ?? []).map((x) => [x.path, x.signedUrl]));

  const slides = rows.map((r) => ({
    position: r.position,
    role: r.role,
    number: r.number,
    caption: r.caption,
    // Baked on demand (render endpoint); editor overlays live text on bgUrl.
    url: `/api/slideshows/${id}/render/${r.position}`,
    bgUrl: r.storage_path
      ? (urlByPath.get(bgPathFor(r.storage_path)) ?? "")
      : "",
    posX: r.position_x ?? 0.5,
    posY: r.position_y ?? 0.82,
    align: (r.align ?? "center") as "left" | "center" | "right",
    maxWidth: r.max_width,
  }));

  return (
    <div className="mx-auto max-w-6xl px-5 py-10 sm:px-8">
      <Link
        href="/dashboard/slideshows"
        className="text-sm text-muted transition-colors hover:text-foreground"
      >
        ← Back to slideshows
      </Link>
      <p className="mt-4 text-xs font-semibold uppercase tracking-wide text-muted">
        {[ss.status, ss.niche].filter(Boolean).join(" · ")}
      </p>
      <SlideshowDetail
        id={ss.id}
        title={ss.title ?? "Untitled slideshow"}
        slides={slides}
        zipHref={`/api/slideshows/${ss.id}/zip`}
        isTikTokConnected={isTikTokConnected}
      />
    </div>
  );
}
