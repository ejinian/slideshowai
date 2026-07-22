import Link from "next/link";
import { Eyebrow } from "./Eyebrow";
import { listGuides } from "@/lib/guides";

// Landing FAQ — doubles as a rich-result surface (FAQPage JSON-LD below).
const FAQS: { q: string; a: string; link?: { label: string; href: string } }[] = [
  {
    q: "What exactly does SlideShowAI make?",
    a: "TikTok Photo Mode slideshows: 9:16 image posts with bold native-style captions. You describe the topic (or upload your own photos), AI writes the hook and captions, picks the images, and hands you post-ready slides in seconds.",
  },
  {
    q: "Can it post to TikTok for me?",
    a: "Yes — connect your TikTok account and publish directly from the app, or queue posts on a schedule so your week goes out automatically.",
  },
  {
    q: "Do I need followers for slideshows to work?",
    a: "No. Slideshows are the strongest format for small accounts because TikTok distributes every post to a fresh test audience — a day-old account's slideshow can look identical to one from a million-follower page.",
  },
  {
    q: "Why are my first posts getting almost no views?",
    a: "Usually account trust, not content. Brand-new accounts that post immediately get throttled as suspected bots — warming the account up for about a week before posting fixes it.",
    link: { label: "Read the 7-day warm-up playbook", href: "/guides/how-to-warm-up-a-new-tiktok-account" },
  },
  {
    q: "Where do the images come from?",
    a: "Your own uploads (best for showing your actual business), or licensed stock plus a curated pool of candid, non-stocky photos matched to each caption by an AI vision check.",
  },
  {
    q: "Is it free to try?",
    a: "Yes — you can generate and download slideshows on the free plan. Paid plans add higher monthly volumes, scheduling, and direct posting.",
  },
];

export function FAQ() {
  // Server component: featured playbooks come straight from content/guides.
  const guides = listGuides().slice(0, 3);
  return (
    <section id="faq" className="relative overflow-hidden pb-24 pt-12 sm:pb-28 sm:pt-14">
      {/* seam structure + ambient light so the section reads as its own room */}
      <div
        aria-hidden
        className="absolute inset-x-20 top-0 h-px bg-linear-to-r from-transparent via-white/12 to-transparent"
      />
      <div
        aria-hidden
        className="absolute inset-x-20 bottom-0 h-px bg-linear-to-r from-transparent via-white/10 to-transparent"
      />
      <div
        aria-hidden
        className="bg-dot-grid absolute inset-0 opacity-40 [mask-image:radial-gradient(70%_60%_at_50%_35%,#000,transparent)]"
      />
      <div
        aria-hidden
        className="animate-float-a pointer-events-none absolute -top-32 left-[12%] h-96 w-[34rem] rounded-full bg-accent/[0.16] blur-[130px]"
      />
      <div
        aria-hidden
        className="animate-float-b pointer-events-none absolute -bottom-24 right-[8%] h-80 w-80 rounded-full bg-fuchsia-500/[0.1] blur-[120px]"
      />

      <div className="relative mx-auto w-full max-w-6xl px-6 sm:px-8">
        <div className="grid gap-12 lg:grid-cols-[1fr_1.45fr] lg:gap-16">
          {/* sticky intro rail */}
          <div className="lg:sticky lg:top-28 lg:self-start">
            <Eyebrow>FAQ</Eyebrow>
            <h2 className="mt-3 text-3xl font-bold tracking-tight text-white sm:text-4xl">
              Questions,
              <br />
              answered
            </h2>
            <p className="mt-4 max-w-sm text-white/50">
              Everything people ask before their first post — and the honest
              answers behind the algorithm folklore.
            </p>
            <div className="mt-7 flex flex-wrap items-center gap-3">
              <Link
                href="/guides"
                className="rounded-full bg-accent px-5 py-2.5 text-sm font-bold text-white shadow-lg shadow-accent/25 transition-all hover:brightness-110"
              >
                Read the guides
              </Link>
              <Link
                href="/signup"
                className="rounded-full bg-white/[0.06] px-5 py-2.5 text-sm font-semibold text-white/80 transition-colors hover:bg-white/[0.1] hover:text-white"
              >
                Just try it →
              </Link>
            </div>
          </div>

          {/* accordion */}
          <div className="space-y-3">
            {FAQS.map((f) => (
              <details
                key={f.q}
                className="group rounded-2xl bg-white/[0.04] px-5 py-4 ring-1 ring-white/[0.07] backdrop-blur-sm transition-all open:bg-white/[0.06] open:ring-accent/35 hover:ring-white/[0.14]"
              >
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-[15px] font-semibold text-white marker:content-none">
                  {f.q}
                  <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-white/[0.07] text-white/40 transition-all group-open:rotate-45 group-open:bg-accent group-open:text-white">
                    <svg
                      width="13" height="13" viewBox="0 0 24 24" fill="none"
                      stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"
                      aria-hidden
                    >
                      <path d="M12 5v14M5 12h14" />
                    </svg>
                  </span>
                </summary>
                <p className="mt-3 border-l-2 border-accent/40 pl-4 pr-8 text-sm leading-relaxed text-white/60">
                  {f.a}
                  {f.link && (
                    <>
                      {" "}
                      <Link
                        href={f.link.href}
                        className="font-medium text-accent-text underline decoration-accent/40 underline-offset-2"
                      >
                        {f.link.label}
                      </Link>
                    </>
                  )}
                </p>
              </details>
            ))}
          </div>
        </div>

        {/* the playbooks, made unmissable — same cards as /guides */}
        <div className="mt-20">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.28em] text-accent-text">
                Guides
              </p>
              <h3 className="mt-2 text-xl font-bold tracking-tight text-white sm:text-2xl">
                The playbooks behind the answers
              </h3>
            </div>
            <Link
              href="/guides"
              className="rounded-full bg-white/[0.06] px-4 py-2 text-sm font-semibold text-white/80 transition-colors hover:bg-white/[0.1] hover:text-white"
            >
              All guides →
            </Link>
          </div>
          <div className="mt-6 grid gap-4 sm:grid-cols-3">
            {guides.map((g, i) => (
              <Link
                key={g.slug}
                href={`/guides/${g.slug}`}
                className="group relative overflow-hidden rounded-2xl bg-linear-to-b from-white/[0.06] to-white/[0.02] p-6 ring-1 ring-white/[0.08] transition-all hover:-translate-y-1 hover:ring-accent/40 hover:shadow-xl hover:shadow-accent/10"
              >
                <span className="absolute right-5 top-5 text-4xl font-extrabold tracking-tight text-white/[0.06] transition-colors group-hover:text-accent/20">
                  0{i + 1}
                </span>
                <p className="text-[11px] font-semibold uppercase tracking-wider text-white/30">
                  {g.minutes} min read
                </p>
                <p className="mt-2 pr-10 font-bold leading-snug text-white">{g.title}</p>
                <p className="mt-2 line-clamp-2 text-sm leading-relaxed text-white/50">
                  {g.description}
                </p>
                <p className="mt-4 inline-flex items-center gap-1.5 text-sm font-semibold text-accent-text">
                  Read the playbook
                  <span aria-hidden className="transition-transform group-hover:translate-x-1">→</span>
                </p>
              </Link>
            ))}
          </div>
        </div>
      </div>

      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "FAQPage",
            mainEntity: FAQS.map((f) => ({
              "@type": "Question",
              name: f.q,
              acceptedAnswer: { "@type": "Answer", text: f.a },
            })),
          }),
        }}
      />
    </section>
  );
}
