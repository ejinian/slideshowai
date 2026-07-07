import { Reveal } from "./Reveal";
import { Eyebrow } from "./Eyebrow";

/* One aesthetic growth curve — no cards, no stats, no heatmap. A smooth
   line sweeping up and to the right (indigo → emerald, the brand's accent
   into the app's data color), soft area glow beneath, floating chips for
   views and conversions, and a live-pulsing dot at the tip. */

export function Benefits() {
  return (
    <section id="benefits" className="bg-surface py-20 sm:py-24">
      <div className="mx-auto max-w-6xl px-5 sm:px-8">
        <Reveal className="mx-auto max-w-2xl text-center">
          <Eyebrow>Why SlideShowAI</Eyebrow>
          <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
            Consistency is what the algorithm rewards
          </h2>
          <p className="mt-4 text-lg text-muted">
            Show up daily and the curve takes care of itself — SlideShowAI
            removes everything standing between your business and the next post.
          </p>
        </Reveal>

        <Reveal delay={120}>
          <div className="relative mx-auto mt-14 max-w-4xl">
            <svg
              viewBox="0 0 1000 420"
              className="w-full"
              role="img"
              aria-label="A smooth curve rising steeply to the right, symbolizing growing views and conversions"
            >
              <defs>
                <linearGradient id="growth-stroke" x1="0" y1="1" x2="1" y2="0">
                  <stop offset="0%" stopColor="#6366f1" />
                  <stop offset="55%" stopColor="#8b5cf6" />
                  <stop offset="100%" stopColor="#34d399" />
                </linearGradient>
                <linearGradient id="growth-fill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#8b5cf6" stopOpacity="0.22" />
                  <stop offset="55%" stopColor="#6366f1" stopOpacity="0.08" />
                  <stop offset="100%" stopColor="#6366f1" stopOpacity="0" />
                </linearGradient>
                <filter id="growth-glow" x="-20%" y="-20%" width="140%" height="140%">
                  <feGaussianBlur stdDeviation="10" />
                </filter>
              </defs>

              {/* faint horizontal guides */}
              {[120, 220, 320].map((y) => (
                <line
                  key={y}
                  x1="0"
                  x2="1000"
                  y1={y}
                  y2={y}
                  stroke="rgba(255,255,255,0.05)"
                  strokeWidth="1"
                />
              ))}

              {/* area under the curve */}
              <path
                d="M0,382 C170,372 300,342 420,290 C540,238 610,196 720,140 C830,84 920,48 1000,30 L1000,420 L0,420 Z"
                fill="url(#growth-fill)"
              />

              {/* glow pass under the line */}
              <path
                d="M0,382 C170,372 300,342 420,290 C540,238 610,196 720,140 C830,84 920,48 1000,30"
                fill="none"
                stroke="url(#growth-stroke)"
                strokeWidth="10"
                strokeLinecap="round"
                opacity="0.35"
                filter="url(#growth-glow)"
              />

              {/* the line itself */}
              <path
                d="M0,382 C170,372 300,342 420,290 C540,238 610,196 720,140 C830,84 920,48 1000,30"
                fill="none"
                stroke="url(#growth-stroke)"
                strokeWidth="4"
                strokeLinecap="round"
              />

              {/* markers on the curve */}
              <circle cx="420" cy="290" r="5" fill="#8b5cf6" />
              <circle cx="720" cy="140" r="5" fill="#a78bfa" />
            </svg>

            {/* floating chips (positions track the viewBox percentages) */}
            <div
              className="absolute flex items-center gap-1.5 rounded-full bg-white/[0.06] px-3 py-1.5 text-xs font-semibold text-white/85 backdrop-blur-sm"
              style={{ left: "42%", top: "58%", transform: "translate(-50%, -140%)" }}
            >
              <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-violet-400" />
              More views
            </div>
            <div
              className="absolute flex items-center gap-1.5 rounded-full bg-white/[0.06] px-3 py-1.5 text-xs font-semibold text-white/85 backdrop-blur-sm"
              style={{ left: "72%", top: "22%", transform: "translate(-50%, -60%)" }}
            >
              <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-violet-300" />
              More conversions
            </div>

            {/* live dot at the tip */}
            <span
              className="absolute flex h-3 w-3"
              style={{ right: "-0.3%", top: "5.5%" }}
            >
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-70" />
              <span className="relative inline-flex h-3 w-3 rounded-full bg-emerald-400" />
            </span>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
