import { CollectionDetail } from "@/components/dashboard/grow/CollectionDetail";

export const metadata = { title: "Collection — SlideLabsAI" };

export default async function CollectionDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <div className="mx-auto w-full max-w-7xl flex-1 px-5 py-8 sm:px-8">
      <CollectionDetail id={id} />
    </div>
  );
}
