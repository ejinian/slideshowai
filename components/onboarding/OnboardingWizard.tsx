"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { completeOnboarding, skipOnboarding } from "@/app/onboarding/actions";
import { PhoneSlideshow } from "@/components/landing/PhoneSlideshow";
import { DEMO_SLIDES, type DemoSlide, type NicheId } from "@/lib/demo-data";

/* First-run experience — on-brand dark theme (hero-glow, indigo accent).
   Arc: a living content wall greets them, two wow demos sell the product,
   three one-tap questions personalize it, and the finish screen pays it all
   off with their own brand fanned out on TikTok-style slides. */

const ACCENT = "#6366f1";

type ShowcaseTile = { img: string; views: number };

// A single particle: spawn offset, drift, size, tint, lifetime. Keystroke
// sparks drift up (dx only); celebration bursts also carry a vertical dy.
type Spark = {
  id: number;
  x: number;
  dx: number;
  dy?: number;
  size: number;
  color: string;
  dur: number;
};

// Particle factories live at module scope: they're only ever called from
// event handlers, never during render.
let sparkSeq = 0;
const SPARK_COLORS = ["#818cf8", "#c084fc", "#ffffff", "#38bdf8"];

function keystrokeBurst(textWidth: number): Spark[] {
  return Array.from({ length: 2 + Math.floor(Math.random() * 2) }, () => ({
    id: sparkSeq++,
    x: textWidth / 2 + Math.random() * 8,
    dx: (Math.random() - 0.35) * 30,
    size: 2.5 + Math.random() * 3,
    color: SPARK_COLORS[Math.floor(Math.random() * SPARK_COLORS.length)],
    dur: 480 + Math.random() * 320,
  }));
}

function celebrationBurst(): Spark[] {
  return Array.from({ length: 12 }, (_, i) => {
    const angle = (i / 12) * Math.PI * 2 + Math.random() * 0.5;
    const dist = 30 + Math.random() * 26;
    return {
      id: sparkSeq++,
      x: 0,
      dx: Math.cos(angle) * dist,
      dy: Math.sin(angle) * dist,
      size: 2.5 + Math.random() * 3.5,
      color: SPARK_COLORS[Math.floor(Math.random() * SPARK_COLORS.length)],
      dur: 420 + Math.random() * 260,
    };
  });
}

const SHOWCASE_A: ShowcaseTile[] = [
  { img: "/library/gym/gym-05.jpg", views: 157_800 },
  { img: "/demo/saas-1.jpeg", views: 901_400 },
  { img: "/library/gym/gym-13.jpg", views: 1_200_000 },
  { img: "/demo/golf-2.jpeg", views: 3_000_000 },
  { img: "/library/gym/gym-09.jpg", views: 3_500_000 },
  { img: "/demo/saas-4.jpeg", views: 441_600 },
];

// Cycled through as an animated "billboard" placeholder in the business field.
const BUSINESS_EXAMPLES = [
  "Home improvement",
  "Real estate",
  "Gym & fitness",
  "Coffee shop",
  "Clothing brand",
  "Med spa",
];

// Line icons only — no emojis in UI (project rule).
const NICHES = [
  { label: "Gym & Fitness", icon: "M6.5 6.5v11M17.5 6.5v11M3 9v6M21 9v6M6.5 12h11" },
  { label: "Food & Dining", icon: "M7 3v6a2 2 0 0 0 4 0V3M9 3v18M17 3c-1.7 1.6-2.5 3.8-2.5 6.5V14H17v7" },
  { label: "Fashion & Beauty", icon: "M8 4l4 2 4-2 4 4-3 2v10H7V10L4 8l4-4z" },
  { label: "Real Estate", icon: "M3 11l9-8 9 8M5 9.5V21h14V9.5M9 21v-6h6v6" },
  { label: "SaaS / Apps", icon: "M3 5h18v14H3zM3 9h18M6 7h.01M9 7h.01" },
  { label: "Coaching & Services", icon: "M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0M12.5 12a.5.5 0 1 1-1 0 .5.5 0 0 1 1 0" },
  { label: "E-commerce", icon: "M3 4h2l2.5 12h11L21 8H7M10 20a1 1 0 1 0 0-2 1 1 0 0 0 0 2zM17 20a1 1 0 1 0 0-2 1 1 0 0 0 0 2z" },
  { label: "Other", icon: "M5 12h.01M12 12h.01M19 12h.01" },
];

// Wizard niche → the demo slide set that best matches it. Niches without a
// matching set fall back to a mixed spread.
const NICHE_TO_DEMO: Record<string, NicheId> = {
  "Gym & Fitness": "gym",
  "Food & Dining": "diet",
  "SaaS / Apps": "saas",
  "Coaching & Services": "business",
};
const FALLBACK_SPREAD: DemoSlide[] = [
  DEMO_SLIDES.gym[0],
  DEMO_SLIDES.diet[0],
  DEMO_SLIDES.saas[0],
];

const GOALS = [
  { id: "followers", label: "Grow my following", sub: "Reach and go viral" },
  { id: "sales", label: "Drive sales", sub: "Turn views into revenue" },
  { id: "leads", label: "Get leads", sub: "Fill the top of my funnel" },
  { id: "brand", label: "Build my brand", sub: "Awareness and authority" },
];

const GOAL_PHRASES: Record<string, string> = {
  followers: "grow your following",
  sales: "turn views into sales",
  leads: "bring in leads",
  brand: "build your brand",
};

const STEP_KEYS = [
  "welcome",
  "wow1",
  "wow2",
  "business",
  "niche",
  "goal",
  "finish",
] as const;
type StepKey = (typeof STEP_KEYS)[number];

export function OnboardingWizard({
  initialBusinessName,
  firstName,
}: {
  initialBusinessName: string;
  firstName: string;
}) {
  const [step, setStep] = useState(0);
  const [businessName, setBusinessName] = useState(initialBusinessName);
  const [businessFocused, setBusinessFocused] = useState(false);
  const [niche, setNiche] = useState<string | null>(null);
  const [goal, setGoal] = useState<string | null>(null);
  const [demoReady, setDemoReady] = useState(false);
  const [pending, startTransition] = useTransition();
  const advanceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Keystroke effects on the business field: sparks fly off the caret and the
  // field flashes a glow ring on every character typed.
  const [sparks, setSparks] = useState<Spark[]>([]);
  const [pulses, setPulses] = useState(0);
  const measureRef = useRef<HTMLSpanElement>(null);

  const total = STEP_KEYS.length;
  const key: StepKey = STEP_KEYS[step];

  const typed = useTypewriter(BUSINESS_EXAMPLES, key === "business");
  const showTypewriter = !businessName && !businessFocused;

  const onBusinessChange = (value: string) => {
    if (value.length > businessName.length && !prefersReducedMotion()) {
      // spawn a small burst at the right edge of the centered text, where the
      // caret sits (measured via the invisible mirror span)
      const textWidth = Math.min(measureRef.current?.offsetWidth ?? 0, 300);
      setSparks((s) => [...s.slice(-14), ...keystrokeBurst(textWidth)]);
      setPulses((p) => p + 1);
    }
    setBusinessName(value);
  };

  useEffect(
    () => () => {
      if (advanceTimer.current) clearTimeout(advanceTimer.current);
    },
    [],
  );

  const next = () => {
    setDemoReady(false);
    setStep((s) => Math.min(s + 1, total - 1));
  };
  const back = () => {
    if (advanceTimer.current) clearTimeout(advanceTimer.current);
    setDemoReady(false);
    setStep((s) => Math.max(s - 1, 0));
  };

  // One-tap questions: picking an answer advances on its own after a beat —
  // long enough for the selection celebration (burst + pulse) to play out.
  const pickAndAdvance = (apply: () => void, delay = 380) => {
    apply();
    if (advanceTimer.current) clearTimeout(advanceTimer.current);
    advanceTimer.current = setTimeout(next, delay);
  };

  // Radial celebration burst on the card that was just picked.
  const [burstSparks, setBurstSparks] = useState<Spark[]>([]);
  const fireBurst = () => {
    if (prefersReducedMotion()) return;
    setBurstSparks(celebrationBurst());
  };

  const finish = () =>
    startTransition(() => {
      void completeOnboarding({
        businessName,
        niche: niche ?? undefined,
        goal: goal ?? undefined,
      });
    });
  const skip = () => startTransition(() => void skipOnboarding());

  const canContinue = key === "business" ? businessName.trim().length > 0 : true;

  const showBack =
    key === "business" || key === "niche" || key === "goal" || key === "finish";
  const showSkip = key === "business" || key === "niche" || key === "goal";
  // niche + goal advance on selection — no Continue button to double-tap
  const showPrimary = key !== "niche" && key !== "goal";
  const primaryLabel = key === "welcome" ? "Get Started" : "Continue";

  return (
    <div className="bg-hero-glow relative flex min-h-screen w-full flex-col items-center overflow-hidden px-5 text-white">
      {/* living content wall behind the welcome copy */}
      {key === "welcome" && <ContentWall />}

      {/* segmented progress */}
      <div className="relative z-10 mt-8 flex w-full max-w-md items-center gap-1.5">
        {STEP_KEYS.map((_, i) => (
          <span
            key={i}
            className="h-1.5 flex-1 rounded-full transition-colors duration-500"
            style={{ backgroundColor: i <= step ? ACCENT : "rgba(255,255,255,0.12)" }}
          />
        ))}
      </div>

      {/* step content — re-keyed so the entrance animation replays each step */}
      <div className="relative z-10 flex w-full flex-1 items-center justify-center">
        <div key={step} className="animate-fade-up w-full max-w-md text-center">
          {key === "welcome" && (
            <>
              <div className="animate-float-a mx-auto grid h-16 w-16 place-items-center rounded-2xl bg-linear-to-br from-accent to-fuchsia-500 shadow-xl shadow-accent/30">
                <SlideMark />
              </div>
              <h1 className="mt-6 text-3xl font-extrabold tracking-tight text-white">
                Welcome to SlideShowAI
              </h1>
              <p className="mx-auto mt-3 max-w-xs text-[15px] leading-relaxed text-white/50">
                Great to have you{firstName ? `, ${firstName}` : ""}. Let&apos;s turn
                your business into scroll-stopping TikToks.
              </p>
            </>
          )}

          {key === "wow1" && (
            <>
              <h1 className="mx-auto max-w-sm text-3xl font-extrabold leading-tight tracking-tight text-white">
                Turn one idea into millions of views
              </h1>
              <div className="mt-8">
                <ShowcaseGrid tiles={SHOWCASE_A} />
              </div>
            </>
          )}

          {key === "wow2" && (
            <>
              <h1 className="mx-auto max-w-sm text-2xl font-extrabold leading-tight tracking-tight text-white">
                You describe it. We do the rest.
              </h1>
              <div className="mt-4">
                <MagicDemo onReady={setDemoReady} />
              </div>
            </>
          )}

          {key === "business" && (
            <>
              <h2 className="text-2xl font-extrabold tracking-tight text-white">
                First — what&apos;s your business called?
              </h2>
              <p className="mt-2 text-[15px] text-white/50">
                Three quick questions, and every caption will sound like you.
              </p>
              <div className="relative mx-auto mt-6 w-full max-w-sm">
                <input
                  value={businessName}
                  onChange={(e) => onBusinessChange(e.target.value)}
                  onFocus={() => setBusinessFocused(true)}
                  onBlur={() => setBusinessFocused(false)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && canContinue) next();
                  }}
                  placeholder=""
                  className={`block w-full rounded-2xl border border-white/10 bg-[#1c1c1e] px-12 py-3.5 text-center text-[15px] text-white outline-none transition-all duration-300 focus:border-transparent focus:ring-2 ${
                    businessName
                      ? "shadow-[0_0_34px_-8px_rgba(99,102,241,0.55)]"
                      : ""
                  }`}
                  style={{ ["--tw-ring-color" as string]: ACCENT }}
                />

                {/* billboard placeholder — types example businesses until they do */}
                {showTypewriter && (
                  <div
                    aria-hidden
                    className="pointer-events-none absolute inset-0 flex items-center justify-center text-[15px] text-white/30"
                  >
                    <span>{typed}</span>
                    <span className="animate-cursor ml-0.5 inline-block h-[1.1em] w-px translate-y-px bg-white/40" />
                  </div>
                )}

                {/* invisible mirror of the value — measures where the caret is */}
                <span
                  ref={measureRef}
                  aria-hidden
                  className="pointer-events-none invisible absolute left-0 top-0 whitespace-pre text-[15px]"
                >
                  {businessName}
                </span>

                {/* keystroke sparks rising off the caret */}
                <span aria-hidden className="pointer-events-none absolute inset-0">
                  {sparks.map((s) => (
                    <span
                      key={s.id}
                      onAnimationEnd={() =>
                        setSparks((cur) => cur.filter((c) => c.id !== s.id))
                      }
                      className="animate-spark absolute top-1/2 rounded-full"
                      style={{
                        left: `calc(50% + ${s.x}px)`,
                        width: s.size,
                        height: s.size,
                        backgroundColor: s.color,
                        animationDuration: `${s.dur}ms`,
                        ["--spark-dx" as string]: `${s.dx}px`,
                      }}
                    />
                  ))}
                </span>

                {/* one-shot glow ring, re-fired on every keystroke */}
                {pulses > 0 && (
                  <span
                    key={pulses}
                    aria-hidden
                    className="animate-input-pulse pointer-events-none absolute inset-0 rounded-2xl"
                  />
                )}

                {canContinue && (
                  <span
                    aria-hidden
                    className="animate-dropdown-in pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 rounded-md bg-white/10 px-1.5 py-1 text-[10px] font-semibold text-white/50"
                  >
                    ↵ Enter
                  </span>
                )}
              </div>
            </>
          )}

          {key === "niche" && (
            <>
              <h2 className="text-2xl font-extrabold tracking-tight text-white">
                What&apos;s your niche?
              </h2>
              <p className="mt-2 text-[15px] text-white/50">Pick the closest match.</p>
              <div className="mx-auto mt-6 grid max-w-sm grid-cols-2 gap-3">
                {NICHES.map((n, i) => {
                  const active = niche === n.label;
                  const dimmed = niche !== null && !active;
                  return (
                    <div
                      key={n.label}
                      className="animate-generate"
                      style={{ animationDelay: `${i * 55}ms` }}
                    >
                      <button
                        type="button"
                        onClick={() =>
                          pickAndAdvance(() => {
                            setNiche(n.label);
                            fireBurst();
                          }, 560)
                        }
                        className={`group relative flex w-full flex-col items-center gap-2 rounded-2xl border px-3 py-4 text-sm font-semibold transition-all duration-300 active:scale-[0.96] ${
                          active
                            ? "z-10 scale-[1.06] border-accent bg-accent/15 text-white shadow-lg shadow-accent/40"
                            : dimmed
                              ? "scale-[0.95] border-white/10 bg-[#1c1c1e] text-white/30 opacity-50"
                              : "border-white/10 bg-[#1c1c1e] text-white/60 hover:-translate-y-1 hover:border-accent/60 hover:bg-accent/[0.07] hover:text-white hover:shadow-lg hover:shadow-accent/15"
                        }`}
                      >
                        <svg
                          aria-hidden
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.8"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          className={`h-5 w-5 transition-all duration-300 group-hover:scale-110 ${
                            active ? "text-accent-text" : "text-white/35 group-hover:text-accent-text"
                          }`}
                        >
                          <path d={n.icon} />
                        </svg>
                        {n.label}

                        {/* selection celebration: glow flash + radial sparks */}
                        {active && (
                          <>
                            <span
                              aria-hidden
                              className="animate-input-pulse pointer-events-none absolute inset-0 rounded-2xl"
                            />
                            <span aria-hidden className="pointer-events-none absolute inset-0">
                              {burstSparks.map((s) => (
                                <span
                                  key={s.id}
                                  onAnimationEnd={() =>
                                    setBurstSparks((cur) => cur.filter((c) => c.id !== s.id))
                                  }
                                  className="animate-spark-burst absolute left-1/2 top-1/2 rounded-full"
                                  style={{
                                    width: s.size,
                                    height: s.size,
                                    backgroundColor: s.color,
                                    animationDuration: `${s.dur}ms`,
                                    ["--spark-dx" as string]: `${s.dx}px`,
                                    ["--spark-dy" as string]: `${s.dy ?? 0}px`,
                                  }}
                                />
                              ))}
                            </span>
                          </>
                        )}
                      </button>
                    </div>
                  );
                })}
              </div>
            </>
          )}

          {key === "goal" && (
            <>
              <h2 className="text-2xl font-extrabold tracking-tight text-white">
                What&apos;s your main goal?
              </h2>
              <p className="mt-2 text-[15px] text-white/50">
                So we know what to optimize for.
              </p>
              <div className="mx-auto mt-6 max-w-sm space-y-2.5">
                {GOALS.map((g, i) => {
                  const active = goal === g.id;
                  const dimmed = goal !== null && !active;
                  return (
                    <div
                      key={g.id}
                      className="animate-generate"
                      style={{ animationDelay: `${i * 70}ms` }}
                    >
                    <button
                      type="button"
                      onClick={() =>
                        pickAndAdvance(() => {
                          setGoal(g.id);
                          fireBurst();
                        }, 560)
                      }
                      className={`relative flex w-full items-center justify-between rounded-2xl border px-4 py-3.5 text-left transition-all duration-300 active:scale-[0.99] ${
                        active
                          ? "z-10 scale-[1.03] border-accent bg-accent/15 shadow-lg shadow-accent/40"
                          : dimmed
                            ? "scale-[0.97] border-white/10 bg-[#1c1c1e] opacity-50"
                            : "border-white/10 bg-[#1c1c1e] hover:-translate-y-0.5 hover:border-accent/60 hover:bg-accent/[0.07] hover:shadow-lg hover:shadow-accent/15"
                      }`}
                    >
                      <span>
                        <span className="block text-sm font-bold text-white">
                          {g.label}
                        </span>
                        <span className="block text-xs text-white/40">{g.sub}</span>
                      </span>
                      <span
                        className="grid h-5 w-5 shrink-0 place-items-center rounded-full border"
                        style={{
                          borderColor: active ? ACCENT : "rgba(255,255,255,0.25)",
                          backgroundColor: active ? ACCENT : "transparent",
                        }}
                      >
                        {active && (
                          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                            <path d="M20 6L9 17l-5-5" />
                          </svg>
                        )}
                      </span>

                      {/* selection celebration: glow flash + radial sparks */}
                      {active && (
                        <>
                          <span
                            aria-hidden
                            className="animate-input-pulse pointer-events-none absolute inset-0 rounded-2xl"
                          />
                          <span aria-hidden className="pointer-events-none absolute inset-0 overflow-visible">
                            {burstSparks.map((s) => (
                              <span
                                key={s.id}
                                onAnimationEnd={() =>
                                  setBurstSparks((cur) => cur.filter((c) => c.id !== s.id))
                                }
                                className="animate-spark-burst absolute left-1/2 top-1/2 rounded-full"
                                style={{
                                  width: s.size,
                                  height: s.size,
                                  backgroundColor: s.color,
                                  animationDuration: `${s.dur}ms`,
                                  ["--spark-dx" as string]: `${s.dx}px`,
                                  ["--spark-dy" as string]: `${s.dy ?? 0}px`,
                                }}
                              />
                            ))}
                          </span>
                        </>
                      )}
                    </button>
                    </div>
                  );
                })}
              </div>
            </>
          )}

          {key === "finish" && (
            <>
              <h1 className="text-3xl font-extrabold tracking-tight text-white">
                {businessName.trim()
                  ? `${businessName.trim()} is ready to go viral`
                  : "You're all set"}
              </h1>
              <p className="mx-auto mt-3 max-w-xs text-[15px] leading-relaxed text-white/50">
                Here&apos;s the vibe — your first slideshow is one click away.
              </p>
              <div className="mt-8">
                <FinishReveal
                  businessName={businessName}
                  niche={niche}
                  goal={goal}
                />
              </div>
            </>
          )}

          {/* controls — on the demo step, wait until the phone has generated
              so the button doesn't dangle above a half-built mockup */}
          {(key !== "wow2" || demoReady) && (
          <div className="animate-fade-up mt-9 flex flex-col items-center gap-3">
            <div className="flex items-center justify-center gap-3">
              {showBack && (
                <button
                  type="button"
                  onClick={back}
                  className="rounded-2xl px-5 py-3.5 text-sm font-semibold text-white/40 transition-colors hover:text-white"
                >
                  Back
                </button>
              )}
              {showPrimary && (
                <button
                  type="button"
                  onClick={key === "finish" ? finish : next}
                  disabled={!canContinue || pending}
                  className="rounded-2xl px-9 py-3.5 text-sm font-bold text-white shadow-lg transition-all hover:brightness-110 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40"
                  style={{ backgroundColor: ACCENT, boxShadow: `0 10px 26px -8px ${ACCENT}80` }}
                >
                  {key === "finish"
                    ? pending
                      ? "Setting up…"
                      : "Create my first slideshow"
                    : primaryLabel}
                </button>
              )}
            </div>
            {showSkip && (
              <button
                type="button"
                onClick={skip}
                disabled={pending}
                className="text-[13px] font-medium text-white/30 transition-colors hover:text-white/60"
              >
                Skip onboarding
              </button>
            )}
          </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ── effects ──────────────────────────────────────────────────────────────── */

function prefersReducedMotion() {
  return (
    typeof window !== "undefined" &&
    !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
  );
}

function formatViews(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(Math.round(n));
}

// Eases a number from 0 → value with requestAnimationFrame, after `delay` ms.
function CountUp({ value, delay = 0 }: { value: number; delay?: number }) {
  const [display, setDisplay] = useState(0);
  useEffect(() => {
    if (prefersReducedMotion()) {
      const id = requestAnimationFrame(() => setDisplay(value));
      return () => cancelAnimationFrame(id);
    }
    const duration = 1400;
    let raf = 0;
    let startTs = 0;
    const start = setTimeout(() => {
      const tick = (ts: number) => {
        if (!startTs) startTs = ts;
        const p = Math.min((ts - startTs) / duration, 1);
        const eased = 1 - Math.pow(1 - p, 3);
        setDisplay(value * eased);
        if (p < 1) raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
    }, delay);
    return () => {
      clearTimeout(start);
      cancelAnimationFrame(raf);
    };
  }, [value, delay]);
  return <>{formatViews(display)}</>;
}

// Billboard-style placeholder: types a word, holds, deletes, moves to the next.
function useTypewriter(words: string[], enabled: boolean) {
  const [text, setText] = useState("");
  const stateRef = useRef({ word: 0, char: 0, phase: "typing" as "typing" | "pausing" | "deleting" });
  useEffect(() => {
    if (!enabled) return;
    if (prefersReducedMotion()) {
      const id = setTimeout(() => setText(words[0] ?? ""), 0);
      return () => clearTimeout(id);
    }
    const s = stateRef.current;
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      const word = words[s.word % words.length];
      if (s.phase === "typing") {
        s.char += 1;
        setText(word.slice(0, s.char));
        timer =
          s.char >= word.length
            ? setTimeout(() => {
                s.phase = "pausing";
                tick();
              }, 1400)
            : setTimeout(tick, 55);
      } else if (s.phase === "pausing") {
        s.phase = "deleting";
        timer = setTimeout(tick, 45);
      } else {
        s.char -= 1;
        setText(word.slice(0, Math.max(0, s.char)));
        if (s.char <= 0) {
          s.word += 1;
          s.phase = "typing";
          timer = setTimeout(tick, 320);
        } else {
          timer = setTimeout(tick, 28);
        }
      }
    };
    timer = setTimeout(tick, 450);
    return () => clearTimeout(timer);
  }, [enabled, words]);
  return text;
}

/* ── bits ─────────────────────────────────────────────────────────────────── */

// The welcome screen's backdrop: dimmed columns of real slides drifting
// vertically at different speeds — an endless content wall. Center is
// vignetted so the copy stays legible. Pure CSS via animate-onboard-marquee.
const WALL_IMAGES = [
  ...new Set(Object.values(DEMO_SLIDES).flat().map((s) => s.image)),
];
const rotated = (n: number) => [
  ...WALL_IMAGES.slice(n),
  ...WALL_IMAGES.slice(0, n),
];
const WALL_COLS = [0, 1, 2, 3, 4].map((i) => rotated(i * 3).slice(0, 6));
const WALL_DURATIONS = [34, 46, 38, 50, 42];
// outermost columns only appear on wider screens
const WALL_COL_VISIBILITY = [
  "hidden lg:block",
  "",
  "",
  "",
  "hidden lg:block",
];

function ContentWall() {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0 overflow-hidden"
      style={{
        WebkitMaskImage:
          "linear-gradient(to bottom, transparent, #000 16%, #000 84%, transparent)",
        maskImage:
          "linear-gradient(to bottom, transparent, #000 16%, #000 84%, transparent)",
      }}
    >
      <div className="flex h-full justify-center gap-3 px-2 opacity-25 sm:gap-4">
        {WALL_COLS.map((imgs, i) => (
          <div
            key={i}
            className={`h-full w-20 shrink-0 sm:w-28 ${WALL_COL_VISIBILITY[i]}`}
          >
            <div
              className="animate-onboard-marquee flex flex-col gap-3 sm:gap-4"
              style={{
                animationDuration: `${WALL_DURATIONS[i]}s`,
                animationDirection: i % 2 ? "reverse" : "normal",
              }}
            >
              {[0, 1].map((copy) => (
                <div key={copy} className="flex flex-col gap-3 sm:gap-4">
                  {imgs.map((src) => (
                    <div
                      key={src}
                      className="aspect-9/16 w-full overflow-hidden rounded-xl ring-1 ring-white/10"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={src}
                        alt=""
                        loading="lazy"
                        decoding="async"
                        draggable={false}
                        className="h-full w-full object-cover"
                      />
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
      {/* center vignette so the welcome copy floats above the wall */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_70%_55%_at_50%_50%,rgba(0,0,0,0.78),transparent_78%)]" />
    </div>
  );
}

function ShowcaseGrid({ tiles }: { tiles: ShowcaseTile[] }) {
  return (
    <div className="mx-auto grid max-w-[320px] grid-cols-3 gap-1.5 rounded-3xl bg-white/[0.03] p-1.5 shadow-[0_20px_50px_-20px_rgba(0,0,0,0.8)] ring-1 ring-white/[0.08]">
      {tiles.map((t, i) => (
        <div
          key={i}
          className="animate-generate relative aspect-9/16 overflow-hidden rounded-xl bg-cover bg-center"
          style={{ backgroundImage: `url(${t.img})`, animationDelay: `${i * 130}ms` }}
        >
          <div className="absolute inset-0 bg-linear-to-t from-black/70 via-transparent to-black/10" />
          <span className="absolute right-1.5 top-1.5 text-white/90">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <rect x="3" y="3" width="18" height="18" rx="2" />
              <circle cx="8.5" cy="8.5" r="1.5" />
              <path d="M21 15l-5-5L5 21" />
            </svg>
          </span>
          <span className="absolute bottom-1.5 left-1.5 flex items-center gap-1 text-[10px] font-bold text-white drop-shadow">
            <svg width="9" height="9" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
              <path d="M8 5v14l11-7z" />
            </svg>
            <CountUp value={t.views} delay={i * 130 + 250} />
          </span>
        </div>
      ))}
    </div>
  );
}

// The finish step's payoff: the user's niche rendered as a fanned spread of
// slides, with their brand handle on the hero slide — "this is you, on TikTok."
const SPREAD_POSITIONS = [
  { dx: 0, rot: 0, scale: 1, z: 10, delay: 120, withHandle: true },
  { dx: -92, rot: -9, scale: 0.9, z: 0, delay: 300, withHandle: false },
  { dx: 92, rot: 9, scale: 0.9, z: 0, delay: 380, withHandle: false },
];

function FinishReveal({
  businessName,
  niche,
  goal,
}: {
  businessName: string;
  niche: string | null;
  goal: string | null;
}) {
  const demoId = niche ? NICHE_TO_DEMO[niche] : undefined;
  const slides = demoId ? DEMO_SLIDES[demoId].slice(0, 3) : FALLBACK_SPREAD;
  const handle =
    "@" + (businessName.toLowerCase().replace(/[^a-z0-9]/g, "") || "yourbrand");
  const goalPhrase = goal ? GOAL_PHRASES[goal] : null;

  return (
    <div>
      <div className="relative mx-auto h-[240px] w-full max-w-sm">
        {slides.map((slide, i) => {
          const p = SPREAD_POSITIONS[i];
          return (
            <div
              key={slide.image}
              className="absolute left-1/2 top-1/2 w-[126px]"
              style={{
                transform: `translate(calc(-50% + ${p.dx}px), -50%) rotate(${p.rot}deg) scale(${p.scale})`,
                zIndex: p.z,
              }}
            >
              <div
                className="animate-generate relative aspect-9/16 overflow-hidden rounded-2xl shadow-2xl shadow-black/60 ring-1 ring-white/15"
                style={{ animationDelay: `${p.delay}ms` }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={slide.image}
                  alt=""
                  draggable={false}
                  className="absolute inset-0 h-full w-full object-cover"
                />
                <div aria-hidden className="absolute inset-0 bg-black/30" />
                <p className="absolute inset-x-2 top-1/2 -translate-y-1/2 text-center text-[10px] font-extrabold leading-tight text-white drop-shadow-[0_2px_6px_rgba(0,0,0,0.9)]">
                  {slide.caption}
                </p>
                {p.withHandle && (
                  <span className="absolute bottom-2 left-2 flex items-center gap-1">
                    <span className="h-3.5 w-3.5 rounded-full bg-linear-to-br from-accent to-fuchsia-500 ring-1 ring-white/80" />
                    <span className="text-[9px] font-semibold text-white drop-shadow">
                      {handle}
                    </span>
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
      {(niche || goalPhrase) && (
        <div className="animate-fade-up mt-6 flex flex-wrap items-center justify-center gap-2">
          {niche && (
            <span className="rounded-full bg-white/[0.06] px-3 py-1.5 text-xs font-semibold text-white/70 ring-1 ring-white/10">
              {niche}
            </span>
          )}
          {goalPhrase && (
            <span className="rounded-full bg-white/[0.06] px-3 py-1.5 text-xs font-semibold text-white/70 ring-1 ring-white/10">
              Optimized to {goalPhrase}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

// wow2's centerpiece: a self-playing demo of the whole product. An empty prompt
// box types itself out, "generates", then morphs into the swiping hero phone.
const DEMO_PROMPT = "Make me a viral gym TikTok slideshow";

function MagicDemo({ onReady }: { onReady: (ready: boolean) => void }) {
  const [typed, setTyped] = useState("");
  const [phase, setPhase] = useState<"typing" | "generating" | "phone">("typing");

  useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = [];
    const reveal = () => {
      setPhase("phone");
      onReady(true);
    };
    if (prefersReducedMotion()) {
      timers.push(
        setTimeout(() => {
          setTyped(DEMO_PROMPT);
          reveal();
        }, 0),
      );
      return () => timers.forEach(clearTimeout);
    }
    let i = 0;
    const type = () => {
      i += 1;
      setTyped(DEMO_PROMPT.slice(0, i));
      if (i < DEMO_PROMPT.length) {
        timers.push(setTimeout(type, 48));
      } else {
        timers.push(setTimeout(() => setPhase("generating"), 650));
        timers.push(setTimeout(reveal, 650 + 1500));
      }
    };
    timers.push(setTimeout(type, 500));
    return () => timers.forEach(clearTimeout);
  }, [onReady]);

  const showingPrompt = phase !== "phone";

  return (
    <div className="relative mx-auto flex w-full justify-center">
      {/* the phone holds the layout height; it fades/scales in on reveal.
          pointer-events-none so it can't catch the cursor and hover-pause —
          this is an autoplaying demo, not something to interact with. */}
      <div
        className={`pointer-events-none transition-all duration-700 ease-out ${
          phase === "phone" ? "scale-100 opacity-100" : "scale-95 opacity-0"
        }`}
        style={{ zoom: 0.82 }}
      >
        <PhoneSlideshow />
      </div>

      {/* prompt box overlays the top while typing / generating */}
      <div
        className={`absolute inset-x-0 top-6 mx-auto flex justify-center px-2 transition-all duration-500 ${
          showingPrompt ? "opacity-100" : "pointer-events-none -translate-y-1 opacity-0"
        }`}
      >
        <div className="w-full max-w-sm rounded-2xl bg-[#1c1c1e] p-4 text-left shadow-2xl shadow-black/60 ring-1 ring-white/[0.06]">
          <div className="min-h-[44px] text-[15px] leading-relaxed text-white/90">
            {typed}
            {phase === "typing" && (
              <span className="animate-cursor ml-px inline-block h-[1.1em] w-px translate-y-px bg-white/50" />
            )}
          </div>
          <div className="mt-3 flex items-center justify-between">
            <span className="text-[11px] font-medium text-white/30">
              {phase === "generating" ? "Generating your slideshow…" : "SlideShowAI"}
            </span>
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-white text-black">
              {phase === "generating" ? (
                <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden>
                  <circle cx="12" cy="12" r="10" stroke="currentColor" strokeOpacity="0.3" strokeWidth="3" />
                  <path d="M22 12a10 10 0 0 1-10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
                </svg>
              ) : (
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d="M12 19V5M5 12l7-7 7 7" />
                </svg>
              )}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

function SlideMark() {
  return (
    <svg width="30" height="30" viewBox="0 0 24 24" fill="none" aria-hidden>
      <rect x="7" y="4" width="13" height="16" rx="2.5" fill="white" fillOpacity="0.4" />
      <rect x="4" y="6" width="13" height="14" rx="2.5" fill="white" />
      <path d="M9.5 10.5v5l4.5-2.5z" fill="#6366f1" />
    </svg>
  );
}
