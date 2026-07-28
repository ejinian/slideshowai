import { Header } from "@/components/landing/Header";
import { Footer } from "@/components/landing/Footer";
import { GuideCards } from "@/components/landing/GuideCards";
import { listGuides } from "@/lib/guides";

export const metadata = {
  title: "TikTok Slideshow Guides — SlideLabsAI",
  description:
    "Playbooks for growing on TikTok with photo slideshows: warming up new accounts, fixing zero-view posts, hooks that stop the scroll, and posting cadence.",
};

export default function GuidesIndex() {
  const guides = listGuides();
  return (
    <>
      <Header />
      <main className="mx-auto w-full max-w-4xl flex-1 px-6 pb-20 pt-28">
        <p className="text-xs font-semibold uppercase tracking-[0.28em] text-accent-text">
          Guides
        </p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight text-white sm:text-4xl">
          Grow on TikTok with slideshows
        </h1>
        <p className="mt-3 max-w-2xl text-white/50">
          Short, practical playbooks — the same tactics behind the viral posts
          in our library of 2,000+ tracked slideshows. No fluff, no jargon.
        </p>

        <div className="mt-4">
          <GuideCards guides={guides} />
        </div>
      </main>
      <Footer />
    </>
  );
}
