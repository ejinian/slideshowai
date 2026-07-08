import { TemplatesView } from "@/components/dashboard/templates/TemplatesView";
import { TEMPLATES } from "@/lib/templates";

export const metadata = { title: "Templates — SlideShowAI" };

export default function TemplatesPage() {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const templates = TEMPLATES.map((t) => ({
    ...t,
    previewUrl: `${base}/storage/v1/object/public/library/${t.previewImage}`,
  }));

  return (
    <div className="mx-auto w-full max-w-7xl flex-1 px-5 py-8 sm:px-8">
      <header>
        <h1 className="text-2xl font-bold tracking-tight text-white">Templates</h1>
        <p className="mt-1 text-sm text-white/40">
          Proven slideshow formats — pick one and it rewrites itself for your
          business.
        </p>
      </header>
      <div className="mt-6">
        <TemplatesView templates={templates} />
      </div>
    </div>
  );
}
