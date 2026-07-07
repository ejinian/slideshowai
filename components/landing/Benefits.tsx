import { Reveal } from "./Reveal";
import { Eyebrow } from "./Eyebrow";

/* Results band: a views-growth chart (same emerald data-line language as the
   app's Trends sparklines), three stat cards, and a posting-streak heatmap.
   The chart is illustrative and labeled as such — no invented case studies. */

const STATS = [
  {
    value: "60 sec",
    label: "from idea to post-ready slideshow",
  },
  {
    value: "24/7",
    label: "trend watch on your niche",
  },
  {
    value: "0 tools",
    label: "no design app, no scheduler, no exports",
  },
];

// Views curve: slow crawl, inflection where daily posting starts, takeoff.
const CURVE = [
  [0, 168], [40, 163], [80, 158], [120, 150], [160, 128],
  [220, 96], [300, 62], [400, 30], [520, 10],
] as const;
const INFLECTION_X = 160;
const INFLECTION_Y = 128;

function GrowthChart() {
  const line = CURVE.map(([x, y]) => `${x},${y}`).join(" ");
  return (
    <svg
      viewBox="0 0 520 190"
      className="mt-4 w-full"
      role="img"
      aria-label="Illustrative chart: views climb sharply after daily posting begins"
    >
      <polygon points={`0,180 ${line} 520,180`} className="fill-emerald-400/10" />
      <polyline
        points={line}
        fill="none"
        stroke="#34d399"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <line
        x1={INFLECTION_X}
        y1="14"
        x2={INFLECTION_X}
        y2="176"
        stroke="#6366f1"
        strokeWidth="1.5"
        strokeDasharray="4 5"
      />
      <circle cx={INFLECTION_X} cy={INFLECTION_Y} r="5" fill="#6366f1" />
      <text x={INFLECTION_X + 12} y="28" className="fill-indigo-300" fontSize="13">
        started posting daily
      </text>
      <circle cx="520" cy="10" r="5" fill="#34d399" />
    </svg>
  );
}

// GitHub-style streak: sparse before SlideShowAI, dense after. Deterministic
// pattern (server-rendered) — 20 weeks x 7 days.
const WEEKS = 20;
const DAYS = 7;
const SWITCH_WEEK = 8;

function streakLevel(week: number, day: number): number {
  if (week < SWITCH_WEEK) {
    return (week * 3 + day * 5) % 11 === 0 ? 1 : 0;
  }
  const n = (week * 5 + day * 3) % 7;
  if (n === 0) return 1;
  if (n < 4) return 2;
  return 3;
}

const STREAK_CLASSES = [
  "bg-white/[0.05]",
  "bg-accent/25",
  "bg-accent/55",
  "bg-accent/90",
];

function StreakHeatmap() {
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <p className="text-sm font-semibold text-white/80">
          Your posting calendar, before and after
        </p>
        <p className="text-xs text-muted">1 square = 1 day</p>
      </div>
      <div className="mt-3 grid grid-flow-col gap-1" style={{ gridTemplateRows: `repeat(${DAYS}, 1fr)` }}>
        {Array.from({ length: WEEKS * DAYS }, (_, i) => {
          const week = Math.floor(i / DAYS);
          const day = i % DAYS;
          return (
            <span
              key={i}
              className={`aspect-square w-full rounded-[3px] ${STREAK_CLASSES[streakLevel(week, day)]}`}
            />
          );
        })}
      </div>
    </div>
  );
}

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
            SlideShowAI removes every excuse between your business and posting
            daily — the ideas, the design, the timing, the upload.
          </p>
        </Reveal>

        <div className="mt-12 grid gap-6 lg:grid-cols-5">
          {/* growth chart */}
          <Reveal className="lg:col-span-3">
            <div className="h-full rounded-card border border-border bg-card p-6 sm:p-7">
              <div className="flex items-baseline justify-between gap-3">
                <p className="text-sm font-semibold text-white/80">
                  What showing up every day looks like
                </p>
                <p className="text-sm font-bold text-emerald-400">views ↑</p>
              </div>
              <GrowthChart />
              <div className="mt-4 flex flex-wrap items-center gap-2">
                <span className="rounded-full bg-white/[0.06] px-2.5 py-1 text-xs font-semibold text-white/70">
                  1 post a day
                </span>
                <span className="rounded-full bg-white/[0.06] px-2.5 py-1 text-xs font-semibold text-white/70">
                  ~60 seconds each
                </span>
                <span className="ml-auto text-xs text-muted">
                  Illustrative — the curve consistency chases
                </span>
              </div>
            </div>
          </Reveal>

          {/* stat cards */}
          <Reveal className="lg:col-span-2" delay={120}>
            <div className="flex h-full flex-col gap-6">
              {STATS.map((stat) => (
                <div
                  key={stat.value}
                  className="flex-1 rounded-card border border-border bg-card px-6 py-5"
                >
                  <p className="text-3xl font-bold tracking-tight">{stat.value}</p>
                  <p className="mt-1 text-sm leading-relaxed text-muted">{stat.label}</p>
                </div>
              ))}
            </div>
          </Reveal>

          {/* streak heatmap */}
          <Reveal className="lg:col-span-5" delay={200}>
            <div className="rounded-card border border-border bg-card p-6 sm:p-7">
              <StreakHeatmap />
            </div>
          </Reveal>
        </div>
      </div>
    </section>
  );
}
