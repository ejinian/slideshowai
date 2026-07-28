import { AccentBar } from "./AccentBar";
import { Reveal } from "./Reveal";
import {
  PLACEHOLDER_TESTIMONIALS,
  TESTIMONIALS,
  type Testimonial,
} from "@/lib/testimonials";

// Community wall — real customer posts, each linking out to the real thing.
//
// Multi-column rather than a grid ON PURPOSE: a grid aligns rows, so every card
// in a row stretches to the tallest one and the whole thing reads as a
// testimonial template. Columns let each card be exactly as tall as its quote,
// which is what makes a wall like this look collected instead of generated.
//
// Renders NOTHING until lib/testimonials.ts has entries — an empty or invented
// wall is worse than no wall.
export function Community({ preview = false }: { preview?: boolean }) {
  // Placeholders pad the wall out so it can be judged while real quotes are
  // still trickling in. They show in `next dev`, or on any deploy behind
  // ?preview=wall — never to an ordinary visitor, who only ever sees real,
  // clickable posts.
  const isDev = process.env.NODE_ENV === "development";
  const items =
    isDev || preview
      ? [...TESTIMONIALS, ...PLACEHOLDER_TESTIMONIALS]
      : TESTIMONIALS;
  if (items.length === 0) return null;

  return (
    <section
      id="community"
      className="relative scroll-mt-20 overflow-hidden py-20 sm:py-28"
    >
      {/* this room's hue: violet, faint */}
      <div
        aria-hidden
        className="glow-blob animate-float-a -top-24 right-[10%] h-72 w-72 bg-violet-500/8"
      />
      <Reveal className="mx-auto max-w-6xl px-5 sm:px-8">
        <h2 className="font-tiktok text-balance text-3xl font-extrabold tracking-tight sm:text-4xl">
          Community.{" "}
          <span className="text-white/40">What customers are saying.</span>
        </h2>
        <AccentBar />

        <div className="mt-10 gap-5 [column-fill:_balance] sm:columns-2 lg:columns-3">
          {items.map((t, i) => (
            <TestimonialCard key={`${t.handle ?? t.name}-${i}`} t={t} />
          ))}
        </div>
      </Reveal>
    </section>
  );
}

function TestimonialCard({ t }: { t: Testimonial }) {
  return (
    // break-inside-avoid is what stops a card splitting across two columns.
    <a
      href={t.url}
      target="_blank"
      rel="noopener noreferrer"
      className="mb-5 block break-inside-avoid rounded-2xl border border-white/8 bg-white/[0.03] p-5 transition-colors hover:border-white/20"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          {t.avatarSrc ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={t.avatarSrc}
              alt=""
              width={40}
              height={40}
              loading="lazy"
              className="h-10 w-10 shrink-0 rounded-full object-cover"
            />
          ) : (
            <span
              aria-hidden
              className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-white/8 text-sm font-semibold text-white/50"
            >
              {t.name.charAt(0).toUpperCase()}
            </span>
          )}
          <div className="min-w-0">
            <p className="truncate text-[15px] font-semibold text-white">
              {t.name}
            </p>
            {t.stars ? (
              <Stars count={t.stars} />
            ) : (
              t.handle && (
                <p className="truncate text-[13px] text-white/40">{t.handle}</p>
              )
            )}
          </div>
        </div>
        <SourceGlyph source={t.source} />
      </div>

      <p className="mt-3.5 text-[15px] leading-relaxed text-white/70">
        {t.quote.map((seg, i) =>
          seg.mark ? (
            // Highlight the concrete claim, not the adjective — a skimmer who
            // reads only the marks should still get the pitch.
            <mark
              key={i}
              className="rounded bg-accent/20 px-0.5 text-white decoration-clone"
            >
              {seg.text}
            </mark>
          ) : (
            <span key={i}>{seg.text}</span>
          ),
        )}
      </p>

      {t.media && (
        <div className="relative mt-4 overflow-hidden rounded-xl border border-white/8">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={t.media.src}
            alt={t.media.alt}
            loading="lazy"
            className="w-full object-cover"
          />
          {t.media.isVideo && (
            <span
              aria-hidden
              className="absolute inset-0 grid place-items-center bg-black/25"
            >
              <span className="grid h-11 w-11 place-items-center rounded-full bg-black/70">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" className="ml-0.5 text-white">
                  <path d="M8 5v14l11-7z" />
                </svg>
              </span>
            </span>
          )}
        </div>
      )}
    </a>
  );
}

function Stars({ count }: { count: number }) {
  return (
    <span className="flex items-center gap-0.5" aria-label={`${count} out of 5 stars`}>
      {Array.from({ length: count }, (_, i) => (
        <svg key={i} width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden className="text-amber-400">
          <path d="M12 2l2.9 6.2 6.6.9-4.8 4.6 1.2 6.6L12 17.2 6.1 20.3l1.2-6.6L2.5 9.1l6.6-.9L12 2z" />
        </svg>
      ))}
    </span>
  );
}

function SourceGlyph({ source }: { source: Testimonial["source"] }) {
  if (source === "youtube") {
    return (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-label="Watch on YouTube" role="img" className="shrink-0 text-white/30">
        <path d="M21.6 7.2a2.5 2.5 0 0 0-1.8-1.8C18.2 5 12 5 12 5s-6.2 0-7.8.4A2.5 2.5 0 0 0 2.4 7.2 26 26 0 0 0 2 12a26 26 0 0 0 .4 4.8 2.5 2.5 0 0 0 1.8 1.8C5.8 19 12 19 12 19s6.2 0 7.8-.4a2.5 2.5 0 0 0 1.8-1.8A26 26 0 0 0 22 12a26 26 0 0 0-.4-4.8zM10 15V9l5.2 3L10 15z" />
      </svg>
    );
  }
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-label="Read on X" role="img" className="shrink-0 text-white/30">
      <path d="M18.24 2.25h3.31l-7.23 8.26 8.5 11.24h-6.65l-5.22-6.82-5.96 6.82H1.68l7.73-8.84L1.25 2.25h6.82l4.71 6.23 5.46-6.23zm-1.16 17.52h1.83L7.01 4.13H5.05l12.03 15.64z" />
    </svg>
  );
}
