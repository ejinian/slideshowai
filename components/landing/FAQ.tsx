import Link from "next/link";
import { listGuides } from "@/lib/guides";
import { AccentBar } from "./AccentBar";
import { Reveal } from "./Reveal";

// Objection-handling FAQ — each question is a real reason people don't buy.
// Doubles as a rich-result surface (FAQPage JSON-LD below).
const FAQS: { q: string; a: string; link?: { label: string; href: string } }[] = [
  {
    q: "Will people be able to tell it's AI?",
    a: "It's your real photos with TikTok-style captions — photo posts don't have an uncanny valley the way AI avatar videos do. Captions are written to sound like a person in your niche, and you can edit any of them before posting.",
  },
  {
    q: "Do I have to film anything or be on camera?",
    a: "No. Slideshows are photo posts — the whole point is that they perform without video. Phone pictures of your product, shop, or work are exactly the right raw material.",
  },
  {
    q: "What if I don't have good photos?",
    a: "Upload what you have (best for showing your actual business), or let SlideShowAI pull licensed stock matched to each caption by an AI vision check.",
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
    q: "Can it post to TikTok for me?",
    a: "Yes — connect your TikTok account and publish directly from the app, or queue posts on a schedule so your week goes out automatically.",
  },
  {
    q: "Is it free to try?",
    a: "Yes — the free plan includes 5 slideshows a month, no credit card required. Paid plans start at $19/month and you can cancel anytime.",
  },
];

export function FAQ() {
  // Server component: featured playbooks come straight from content/guides.
  const guides = listGuides().slice(0, 3);
  return (
    <section id="faq" className="relative scroll-mt-20 overflow-hidden py-20 sm:py-28">
      {/* this room's hue: sky, faint */}
      <div
        aria-hidden
        className="glow-blob animate-float-b -top-20 left-[8%] h-72 w-72 bg-sky-500/8"
      />
      <Reveal className="mx-auto max-w-3xl px-5 sm:px-8">
        <h2 className="font-tiktok text-balance text-3xl font-extrabold tracking-tight sm:text-4xl">
          Fair questions, straight answers
        </h2>
        <AccentBar />

        <div className="mt-10">
          {FAQS.map((f) => (
            <details key={f.q} className="group border-t border-white/10">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 py-5 text-[15px] font-semibold text-white marker:content-none">
                {f.q}
                <span
                  aria-hidden
                  className="shrink-0 text-white/35 transition-all group-open:rotate-45 group-open:text-accent-text"
                >
                  <svg
                    width="14" height="14" viewBox="0 0 24 24" fill="none"
                    stroke="currentColor" strokeWidth="2" strokeLinecap="round"
                  >
                    <path d="M12 5v14M5 12h14" />
                  </svg>
                </span>
              </summary>
              <p className="pb-6 pr-8 text-[15px] leading-relaxed text-white/60">
                {f.a}
                {f.link && (
                  <>
                    {" "}
                    <Link
                      href={f.link.href}
                      className="font-medium text-white underline decoration-white/30 underline-offset-2 hover:decoration-white"
                    >
                      {f.link.label}
                    </Link>
                  </>
                )}
              </p>
            </details>
          ))}
          <div aria-hidden className="border-t border-white/10" />
        </div>

        {/* featured playbooks — quiet, type-only */}
        <div className="mt-16">
          <div className="flex items-baseline justify-between gap-4">
            <h3 className="text-lg font-semibold text-white">From the guides</h3>
            <Link
              href="/guides"
              className="text-sm text-white/50 transition-colors hover:text-white"
            >
              All guides →
            </Link>
          </div>
          <div className="mt-5 grid gap-6 sm:grid-cols-3">
            {guides.map((g) => (
              <Link
                key={g.slug}
                href={`/guides/${g.slug}`}
                className="group border-t border-white/10 pt-4"
              >
                <p className="text-xs text-white/35">{g.minutes} min read</p>
                <p className="mt-1.5 font-semibold leading-snug text-white">
                  {g.title}
                </p>
                <p className="mt-2 text-sm text-white/50 transition-colors group-hover:text-white">
                  Read →
                </p>
              </Link>
            ))}
          </div>
        </div>
      </Reveal>

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
