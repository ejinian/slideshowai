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

// Composited PNG path -> text-free background path (uploaded by the generate route).
const bgPathFor = (p: string) => p.replace(/\.png$/, "-bg.jpg");

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

  const { data: slideRows } = await supabase
    .from("slides")
    .select(
      "position, role, number, caption, storage_path, position_x, position_y, align, max_width",
    )
    .eq("slideshow_id", id)
    .order("position", { ascending: true });
  const rows = (slideRows ?? []) as SlideRow[];

  const paths = rows
    .map((r) => r.storage_path)
    .filter((p): p is string => Boolean(p));
  // Sign both the composited PNGs and the text-free backgrounds (the editor
  // overlays live HTML text on the latter). Missing bg objects just yield "".
  const { data: signed } = await supabase.storage
    .from("slideshows")
    .createSignedUrls([...paths, ...paths.map(bgPathFor)], 3600);
  const urlByPath = new Map((signed ?? []).map((x) => [x.path, x.signedUrl]));

  const slides = rows.map((r) => ({
    position: r.position,
    role: r.role,
    number: r.number,
    caption: r.caption,
    url: r.storage_path ? (urlByPath.get(r.storage_path) ?? "") : "",
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
      />
    </div>
  );
}
