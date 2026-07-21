import Link from "next/link";
import { notFound } from "next/navigation";
import { Header } from "@/components/landing/Header";
import { Footer } from "@/components/landing/Footer";
import { Markdown } from "@/components/landing/Markdown";
import { getGuide, listGuides } from "@/lib/guides";

// Fully static: every guide is baked at build time from content/guides/*.md.
export function generateStaticParams() {
  return listGuides().map((g) => ({ slug: g.slug }));
}
export const dynamicParams = false;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const guide = getGuide(slug);
  if (!guide) return {};
  return {
    title: `${guide.title} — SlideShowAI Guides`,
    description: guide.description,
  };
}

export default async function GuidePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const guide = getGuide(slug);
  if (!guide) notFound();

  const others = listGuides().filter((g) => g.slug !== slug).slice(0, 3);
  const faqJsonLd =
    guide.faq.length > 0
      ? {
          "@context": "https://schema.org",
          "@type": "FAQPage",
          mainEntity: guide.faq.map((f) => ({
            "@type": "Question",
            name: f.question,
            acceptedAnswer: { "@type": "Answer", text: f.answer },
          })),
        }
      : null;

  return (
    <>
      <Header />
      <main className="mx-auto w-full max-w-3xl flex-1 px-6 pb-20 pt-28">
        <Link
          href="/guides"
          className="text-xs font-semibold uppercase tracking-[0.28em] text-accent-text transition-opacity hover:opacity-80"
        >
          ← Guides
        </Link>
        <h1 className="mt-3 text-3xl font-bold leading-tight tracking-tight text-white sm:text-4xl">
          {guide.title}
        </h1>
        <p className="mt-3 text-white/50">{guide.description}</p>
        <p className="mt-2 text-xs font-medium text-white/30">
          {guide.minutes} min read
        </p>

        <article className="mt-10">
          <Markdown blocks={guide.blocks} />
        </article>

        {guide.faq.length > 0 && (
          <section className="mt-12">
            <h2 className="text-xl font-bold tracking-tight text-white">FAQ</h2>
            <div className="mt-4 space-y-3">
              {guide.faq.map((f) => (
                <details
                  key={f.question}
                  className="group rounded-xl bg-white/[0.03] px-5 py-4 ring-1 ring-white/[0.06]"
                >
                  <summary className="cursor-pointer list-none text-sm font-semibold text-white marker:content-none">
                    {f.question}
                  </summary>
                  <p className="mt-2 text-sm leading-relaxed text-white/60">
                    {f.answer}
                  </p>
                </details>
              ))}
            </div>
          </section>
        )}

        {/* CTA */}
        <div className="mt-14 rounded-2xl bg-accent/[0.08] p-8 text-center ring-1 ring-accent/20">
          <h2 className="text-xl font-bold text-white">
            Skip the hard part — let AI make the slideshows
          </h2>
          <p className="mx-auto mt-2 max-w-md text-sm text-white/60">
            SlideShowAI writes the hooks, picks the photos, and gives you
            post-ready TikTok slideshows in seconds. Free to start.
          </p>
          <Link
            href="/signup"
            className="mt-5 inline-block rounded-full bg-accent px-7 py-3 text-sm font-bold text-white shadow-lg shadow-accent/30 transition-all hover:brightness-110"
          >
            Try it free
          </Link>
        </div>

        {others.length > 0 && (
          <section className="mt-14">
            <h2 className="text-sm font-bold uppercase tracking-wider text-white/30">
              Keep reading
            </h2>
            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              {others.map((g) => (
                <Link
                  key={g.slug}
                  href={`/guides/${g.slug}`}
                  className="rounded-xl bg-white/[0.03] p-4 text-sm font-semibold leading-snug text-white/80 ring-1 ring-white/[0.06] transition-colors hover:bg-white/[0.05] hover:text-white"
                >
                  {g.title}
                </Link>
              ))}
            </div>
          </section>
        )}
      </main>
      <Footer />
      {faqJsonLd && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }}
        />
      )}
    </>
  );
}
