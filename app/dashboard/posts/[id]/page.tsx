import { notFound, redirect } from "next/navigation";
import { createClient, getCachedUser } from "@/utils/supabase/server";
import { accountLabel } from "@/lib/tiktok/accountLabel";
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
  open_id: string | null;
  slideshow: { id: string; title: string | null; slides: SlideRow[] } | null;
}

export default async function PostDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const user = await getCachedUser();
  if (!user) redirect("/?auth=login");

  const { data } = await supabase
    .from("tiktok_posts")
    .select(
      "id, caption, privacy_level, status, fail_reason, cover_index, created_at, open_id, slideshow:slideshows(id, title, slides(position, storage_path, caption))",
    )
    .eq("id", id)
    .single();

  const post = data as unknown as PostRow | null;
  if (!post) notFound();

  // Account row is only informative with several accounts connected.
  let account: string | null = null;
  if (post.open_id) {
    const { data: conns } = await supabase
      .from("tiktok_connections")
      .select("open_id, display_name, username")
      .eq("user_id", user.id);
    if ((conns?.length ?? 0) > 1) {
      const c = conns?.find((r) => r.open_id === post.open_id);
      if (c) {
        account = accountLabel({
          openId: c.open_id,
          displayName: c.display_name,
          username: c.username,
        });
      }
    }
  }

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
      account={account}
    />
  );
}
