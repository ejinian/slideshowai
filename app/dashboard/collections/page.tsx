import { CollectionsGrid } from "@/components/dashboard/grow/CollectionsGrid";

export const metadata = { title: "Collections — SlideLabsAI" };

export default function CollectionsPage() {
  return (
    <div className="mx-auto w-full max-w-7xl flex-1 px-5 py-8 sm:px-8">
      <header>
        <h1 className="text-2xl font-bold tracking-tight text-white">
          Collections
        </h1>
        <p className="mt-1 text-sm text-white/40">
          Organize the images your slideshows are built from.
        </p>
      </header>
      <div className="mt-6">
        <CollectionsGrid />
      </div>
    </div>
  );
}
