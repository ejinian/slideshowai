import { InspirationLibrary } from "@/components/dashboard/grow/InspirationLibrary";

export const metadata = { title: "Inspiration — SlideShowAI" };

export default function InspirationPage() {
  return (
    <div className="mx-auto w-full max-w-7xl flex-1 px-5 py-8 sm:px-8">
      <header>
        <h1 className="text-2xl font-bold tracking-tight text-white">
          Inspiration
        </h1>
        <p className="mt-1 text-sm text-white/40">
          Viral slideshow formats by niche — steal the structure, make it yours.
        </p>
      </header>
      <div className="mt-6">
        <InspirationLibrary />
      </div>
    </div>
  );
}
