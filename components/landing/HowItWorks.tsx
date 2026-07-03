import { Reveal } from "./Reveal";
import { Eyebrow } from "./Eyebrow";

/* -------------------------------------------------------------------------- */
/*  Shared mockup primitives — a faux "SlideShowAI" app window                 */
/* -------------------------------------------------------------------------- */

function WindowChrome({
  title,
  subtitle,
  action,
  children,
}: {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="overflow-hidden rounded-2xl border border-white/10 bg-[#0c0c0e] shadow-2xl shadow-black/60 ring-1 ring-black/40">
      <div className="flex">
        {/* sidebar */}
        <aside className="hidden w-32 shrink-0 flex-col justify-between border-r border-white/[0.06] p-3 sm:flex">
          <div>
            <div className="flex items-center gap-1.5">
              <span className="h-4 w-4 rounded-md bg-linear-to-br from-accent to-fuchsia-500" />
              <span className="text-[10px] font-bold text-white">SlideShowAI</span>
            </div>
            <nav className="mt-4 space-y-1.5 text-[9px] text-white/45">
              <p className="rounded bg-white/[0.06] px-1.5 py-1 text-white/80">Dashboard</p>
              <p className="px-1.5 py-1">Slideshows</p>
              <p className="px-1.5 py-1">Images</p>
            </nav>
          </div>
          <div className="space-y-1.5 text-[9px] text-white/35">
            <p className="px-1.5">Admin</p>
            <p className="px-1.5">Share feedback</p>
            <p className="px-1.5">Settings</p>
          </div>
        </aside>

        {/* main */}
        <div className="min-w-0 flex-1 p-3.5">
          <div className="flex items-start justify-between gap-2">
            <div>
              <h4 className="text-[13px] font-bold leading-tight text-white">{title}</h4>
              {subtitle && <p className="mt-0.5 text-[9px] text-white/40">{subtitle}</p>}
            </div>
            {action}
          </div>
          <div className="mt-3">{children}</div>
        </div>
      </div>
    </div>
  );
}

function PillButton({
  children,
  variant = "ghost",
}: {
  children: React.ReactNode;
  variant?: "ghost" | "accent";
}) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-[9px] font-semibold ${
        variant === "accent"
          ? "bg-accent text-white"
          : "bg-white/10 text-white/80"
      }`}
    >
      {children}
    </span>
  );
}

function Tile({
  img,
  n,
  caption,
}: {
  img: string;
  n: number;
  caption?: string;
}) {
  return (
    <div
      className="relative aspect-9/16 overflow-hidden rounded-md bg-cover bg-center ring-1 ring-white/10"
      style={{ backgroundImage: `url(${img})` }}
    >
      <span className="absolute left-1 top-1 grid h-3.5 w-3.5 place-items-center rounded-full bg-black/60 text-[7px] font-bold text-white">
        {n}
      </span>
      {caption && (
        <div className="absolute inset-x-0 bottom-0 bg-linear-to-t from-black/85 to-transparent px-1.5 pb-1.5 pt-3">
          <p className="line-clamp-2 text-[7.5px] font-semibold leading-tight text-white">
            {caption}
          </p>
        </div>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  The three product mockups                                                  */
/* -------------------------------------------------------------------------- */

function MockCarousel() {
  const tiles = [
    { img: "/library/gym/gym-05.jpg", caption: "Ever feel stuck in startup limbo?" },
    { img: "/demo/saas-1.jpeg", caption: "Was hustling but getting nowhere fast" },
    { img: "/library/gym/gym-13.jpg", caption: "Found the secret sauce: pivot and adapt" },
    { img: "/demo/golf-2.jpeg", caption: "Ditch the grind, embrace smart moves" },
    { img: "/library/gym/gym-09.jpg" },
    { img: "/demo/saas-4.jpeg" },
    { img: "/library/gym/gym-16.jpg" },
  ];
  return (
    <WindowChrome
      title="Carousel Slides"
      subtitle="7 slides added"
      action={<PillButton variant="accent">Generate Captions</PillButton>}
    >
      <div className="grid grid-cols-4 gap-2">
        {tiles.map((t, i) => (
          <Tile key={i} img={t.img} n={i + 1} caption={t.caption} />
        ))}
        {/* add-slide tile */}
        <div className="grid aspect-9/16 place-items-center rounded-md border border-dashed border-white/15 text-center">
          <div className="text-white/40">
            <div className="mx-auto text-base leading-none">+</div>
            <div className="mt-0.5 text-[7px]">Add Slide</div>
          </div>
        </div>
      </div>
    </WindowChrome>
  );
}

function MockGenerate() {
  const bg = [
    "/demo/saas-2.jpeg",
    "/library/gym/gym-02.jpg",
    "/demo/golf-4.jpeg",
    "/demo/diet-2.jpeg",
    "/library/gym/gym-11.jpg",
    "/demo/golf-1.jpeg",
  ];
  return (
    <WindowChrome
      title="My Slideshows"
      subtitle="Hello, Jake"
      action={<PillButton variant="accent">Create new</PillButton>}
    >
      <div className="relative">
        {/* faded slideshow grid behind the modal */}
        <div className="grid grid-cols-3 gap-2 opacity-40 blur-[1.5px]">
          {bg.map((img, i) => (
            <Tile key={i} img={img} n={i + 1} />
          ))}
        </div>

        {/* generate modal */}
        <div className="absolute inset-0 grid place-items-center px-2">
          <div className="w-full max-w-[230px] rounded-lg border border-white/10 bg-[#1a1a1c] p-3 shadow-2xl">
            <Field label="Content Format" value="Tips & Insights" chevron />
            <Field label="Category" value="Mental Health" chevron />
            <Field label="Number of Slides" value="8" />
            <div className="mt-2">
              <p className="text-[8px] text-white/45">Content Context</p>
              <div className="mt-1 h-9 rounded-md bg-white/[0.04] p-1.5 text-[7.5px] leading-tight text-white/30">
                What should this slideshow be about? Include key points, target
                audience, and any specific details…
              </div>
            </div>
            <div className="mt-2.5 flex justify-end gap-1.5">
              <span className="rounded-md bg-white/10 px-2 py-1 text-[8px] font-semibold text-white/70">
                Cancel
              </span>
              <span className="rounded-md bg-accent px-2 py-1 text-[8px] font-semibold text-white">
                Generate slideshow
              </span>
            </div>
          </div>
        </div>
      </div>
    </WindowChrome>
  );
}

function Field({
  label,
  value,
  chevron,
}: {
  label: string;
  value: string;
  chevron?: boolean;
}) {
  return (
    <div className="mb-2">
      <p className="text-[8px] text-white/45">{label}</p>
      <div className="mt-1 flex items-center justify-between rounded-md bg-white/[0.05] px-2 py-1.5">
        <span className="text-[8.5px] text-white/80">{value}</span>
        {chevron && <span className="text-[8px] text-white/40">▾</span>}
      </div>
    </div>
  );
}

function MockReady() {
  const tiles = [
    { img: "/demo/diet-1.jpeg", caption: "Feeling solo? Let's flip the script" },
    { img: "/library/gym/gym-07.jpg", caption: "Nature walks: instant mood booster" },
    { img: "/demo/saas-3.jpeg", caption: "Limit doom-scrolling, boost real chats" },
    { img: "/demo/golf-3.jpeg", caption: "Get artsy, let your mind breathe" },
    { img: "/library/gym/gym-18.jpg", caption: "Gratitude journaling: tiny shifts, big feels" },
    { img: "/demo/golf-1.jpeg", caption: "Volunteer: connection vibes unlocked" },
  ];
  return (
    <WindowChrome
      title="Your Carousel is Ready"
      subtitle="Preview your slides and download them for posting"
      action={
        <div className="flex items-center gap-1.5">
          <span className="text-[8px] text-white/40">Post to TikTok (coming soon)</span>
          <PillButton>↓ Download All</PillButton>
        </div>
      }
    >
      <div className="grid grid-cols-3 gap-2">
        {tiles.map((t, i) => (
          <Tile key={i} img={t.img} n={i + 1} caption={t.caption} />
        ))}
      </div>
    </WindowChrome>
  );
}

/* -------------------------------------------------------------------------- */
/*  Feature rows                                                               */
/* -------------------------------------------------------------------------- */

interface Feature {
  title: string;
  desc: string;
  mockup: React.ReactNode;
}

const FEATURES: Feature[] = [
  {
    title: "Create Insta & TikTok Carousels",
    desc: "Create viral TikTok slideshows with ease. Use AI to generate captions for your slides.",
    mockup: <MockCarousel />,
  },
  {
    title: "Start with AI, edit with ease",
    desc: "Use AI to create the first slides for you — including images and captions. Then fine-tune them in the editor.",
    mockup: <MockGenerate />,
  },
  {
    title: "Download or post your TikTok slideshow",
    desc: "Download your TikTok slideshow as a zip file, or send it directly to your TikTok account.",
    mockup: <MockReady />,
  },
];

export function HowItWorks() {
  return (
    <section id="how-it-works" className="py-20 sm:py-28">
      <div className="mx-auto max-w-6xl px-5 sm:px-8">
        <Reveal className="mx-auto max-w-2xl text-center">
          <Eyebrow>How it works</Eyebrow>
          <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
            Everything you need to go viral
          </h2>
          <p className="mt-4 text-lg text-muted">
            From a blank idea to a post-ready TikTok slideshow — without opening a
            design tool.
          </p>
        </Reveal>

        <div className="mt-16 space-y-20 sm:space-y-28">
          {FEATURES.map((feature, i) => {
            const reverse = i % 2 === 1;
            return (
              <div
                key={feature.title}
                className="grid items-center gap-10 lg:grid-cols-2 lg:gap-16"
              >
                {/* copy */}
                <Reveal className={reverse ? "lg:order-2" : ""}>
                  <p className="text-sm font-bold tracking-[0.3em] text-accent-text">
                    0{i + 1}
                  </p>
                  <h3 className="mt-3 text-2xl font-bold tracking-tight sm:text-3xl">
                    {feature.title}
                  </h3>
                  <p className="mt-4 max-w-md text-lg leading-relaxed text-muted">
                    {feature.desc}
                  </p>
                  <a
                    href="/dashboard"
                    className="mt-7 inline-flex items-center gap-1.5 rounded-full bg-white/10 px-5 py-2.5 text-sm font-semibold text-foreground transition-colors hover:bg-white/15"
                  >
                    Get started
                    <span aria-hidden>→</span>
                  </a>
                </Reveal>

                {/* mockup */}
                <Reveal
                  className={reverse ? "lg:order-1" : ""}
                  delay={120}
                >
                  {feature.mockup}
                </Reveal>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
