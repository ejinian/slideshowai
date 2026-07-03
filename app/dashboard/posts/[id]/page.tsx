import { notFound, redirect } from "next/navigation";
import { createClient } from "@/utils/supabase/server";
import { PostViewer } from "@/components/dashboard/posts/PostViewer";

export const dynamic = "force-dynamic";

interface SlideRow {
  position: number;
  storage_path: string | null;
  caption: string | null;
}
interface PostRow {
  id: string;
  caption: string | null;
  privacy_level: string | null;
  status: string | null;
  fail_reason: string | null;
  cover_index: number | null;
  created_at: string;
  slideshow: { id: string; title: string | null; slides: SlideRow[] } | null;
}

export default async function PostDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data } = await supabase
    .from("tiktok_posts")
    .select(
      "id, caption, privacy_level, status, fail_reason, cover_index, created_at, slideshow:slideshows(id, title, slides(position, storage_path, caption))",
    )
    .eq("id", id)
    .single();

  const post = data as unknown as PostRow | null;
  if (!post) notFound();

  const slideshowId = post.slideshow?.id ?? id;
  const slides = [...(post.slideshow?.slides ?? [])].sort((a, b) => a.position - b.position);
  // Baked on demand from the clean bg + live caption (never a stored bake).
  const withUrls = slides.map((s) => ({
    position: s.position,
    url: `/api/slideshows/${slideshowId}/render/${s.position}`,
    caption: s.caption ?? "",
  }));

  return (
    <PostViewer
      slides={withUrls}
      caption={post.caption ?? ""}
      privacy={post.privacy_level ?? "SELF_ONLY"}
      status={post.status ?? "PROCESSING_DOWNLOAD"}
      failReason={post.fail_reason}
      createdAt={post.created_at}
      coverIndex={post.cover_index ?? 0}
    />
  );
}
