import Link from "next/link";
import { Eyebrow } from "./Eyebrow";

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
  return (
    <section id="faq" className="mx-auto w-full max-w-3xl px-6 py-20 sm:py-24">
      <div className="text-center">
        <Eyebrow>FAQ</Eyebrow>
        <h2 className="mt-3 text-3xl font-bold tracking-tight text-white sm:text-4xl">
          Questions, answered
        </h2>
      </div>
      <div className="mt-10 space-y-3">
        {FAQS.map((f) => (
          <details
            key={f.q}
            className="group rounded-xl bg-white/[0.03] px-5 py-4 ring-1 ring-white/[0.06]"
          >
            <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-sm font-semibold text-white marker:content-none">
              {f.q}
              <svg
                width="14" height="14" viewBox="0 0 24 24" fill="none"
                stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
                aria-hidden
                className="shrink-0 text-white/30 transition-transform group-open:rotate-180"
              >
                <path d="M6 9l6 6 6-6" />
              </svg>
            </summary>
            <p className="mt-2 text-sm leading-relaxed text-white/60">
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
      <p className="mt-8 text-center text-sm text-white/40">
        Want the deeper playbooks?{" "}
        <Link href="/guides" className="font-semibold text-accent-text hover:underline">
          Read the guides →
        </Link>
      </p>
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
