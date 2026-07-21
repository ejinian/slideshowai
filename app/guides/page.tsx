import Link from "next/link";
import { Header } from "@/components/landing/Header";
import { Footer } from "@/components/landing/Footer";
import { listGuides } from "@/lib/guides";

export const metadata = {
  title: "TikTok Slideshow Guides — SlideShowAI",
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

        <div className="mt-10 grid gap-4 sm:grid-cols-2">
          {guides.map((g) => (
            <Link
              key={g.slug}
              href={`/guides/${g.slug}`}
              className="group rounded-2xl bg-white/[0.03] p-6 ring-1 ring-white/[0.06] transition-all hover:-translate-y-0.5 hover:bg-white/[0.05] hover:ring-accent/40"
            >
              <p className="text-[11px] font-semibold uppercase tracking-wider text-white/30">
                {g.minutes} min read
              </p>
              <h2 className="mt-2 text-lg font-bold leading-snug text-white group-hover:text-white">
                {g.title}
              </h2>
              <p className="mt-2 text-sm leading-relaxed text-white/50">
                {g.description}
              </p>
            </Link>
          ))}
        </div>
      </main>
      <Footer />
    </>
  );
}
