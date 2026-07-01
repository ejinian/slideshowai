"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { completeOnboarding, skipOnboarding } from "@/app/onboarding/actions";
import { PhoneSlideshow } from "@/components/landing/PhoneSlideshow";

/* First-run experience — on-brand dark theme (hero-glow, indigo accent) with
   social-proof showcases, count-up view numbers, cascading image reveals and a
   billboard-style typewriter, all to make the product feel high-end. */

const ACCENT = "#6366f1";
const ACCENT_TINT = "rgba(99,102,241,0.12)";

type ShowcaseTile = { img: string; views: number };

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

const NICHES = [
  "Gym & Fitness",
  "Food & Dining",
  "Fashion & Beauty",
  "Real Estate",
  "SaaS / Apps",
  "Coaching & Services",
  "E-commerce",
  "Other",
];

const GOALS = [
  { id: "followers", label: "Grow my following", sub: "Reach and go viral" },
  { id: "sales", label: "Drive sales", sub: "Turn views into revenue" },
  { id: "leads", label: "Get leads", sub: "Fill the top of my funnel" },
  { id: "brand", label: "Build my brand", sub: "Awareness and authority" },
];

const STEP_KEYS = [
  "welcome",
  "wow1",
  "wow2",
  "valueprop",
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

  const total = STEP_KEYS.length;
  const key: StepKey = STEP_KEYS[step];

  const typed = useTypewriter(BUSINESS_EXAMPLES, key === "business");
  const showTypewriter = !businessName && !businessFocused;

  const next = () => {
    setDemoReady(false);
    setStep((s) => Math.min(s + 1, total - 1));
  };
  const back = () => {
    setDemoReady(false);
    setStep((s) => Math.max(s - 1, 0));
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

  const canContinue =
    key === "business"
      ? businessName.trim().length > 0
      : key === "niche"
        ? !!niche
        : key === "goal"
          ? !!goal
          : true;

  const showBack = key === "business" || key === "niche" || key === "goal";
  const showSkip =
    key === "valueprop" || key === "business" || key === "niche" || key === "goal";
  const primaryLabel =
    key === "welcome" ? "Get Started" : key === "valueprop" ? "Let's go" : "Continue";

  return (
    <div className="bg-hero-glow relative flex min-h-screen w-full flex-col items-center px-5 text-white">
      {/* segmented progress */}
      <div className="mt-8 flex w-full max-w-md items-center gap-1.5">
        {STEP_KEYS.map((_, i) => (
          <span
            key={i}
            className="h-1.5 flex-1 rounded-full transition-colors duration-500"
            style={{ backgroundColor: i <= step ? ACCENT : "rgba(255,255,255,0.12)" }}
          />
        ))}
      </div>

      {/* step content — re-keyed so the entrance animation replays each step */}
      <div className="flex w-full flex-1 items-center justify-center">
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
                SlideShowAI is literally a content machine
              </h1>
              <div className="mt-8">
                <ShowcaseGrid tiles={SHOWCASE_A} />
              </div>
            </>
          )}

          {key === "wow2" && (
            <>
              <h1 className="mx-auto max-w-sm text-2xl font-extrabold leading-tight tracking-tight text-white">
                You describe it, and we do the rest 🔥
              </h1>
              <div className="mt-4">
                <MagicDemo onReady={setDemoReady} />
              </div>
            </>
          )}

          {key === "valueprop" && (
            <>
              <h1 className="mx-auto max-w-sm text-3xl font-extrabold leading-tight tracking-tight text-white">
                Let&apos;s make your first slideshow
              </h1>
              <p className="mx-auto mt-3 max-w-xs text-[15px] leading-relaxed text-white/50">
                Answer 3 quick questions and we&apos;ll tailor ready-to-post
                slideshows to your business — right now.
              </p>
            </>
          )}

          {key === "business" && (
            <>
              <h2 className="text-2xl font-extrabold tracking-tight text-white">
                What&apos;s your business called?
              </h2>
              <p className="mt-2 text-[15px] text-white/50">
                We&apos;ll use it to personalize your captions.
              </p>
              <div className="relative mx-auto mt-6 w-full max-w-sm">
                <input
                  value={businessName}
                  onChange={(e) => setBusinessName(e.target.value)}
                  onFocus={() => setBusinessFocused(true)}
                  onBlur={() => setBusinessFocused(false)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && canContinue) next();
                  }}
                  placeholder=""
                  className="block w-full rounded-2xl border border-white/10 bg-[#1c1c1e] px-4 py-3.5 text-center text-[15px] text-white outline-none transition-all focus:border-transparent focus:ring-2"
                  style={{ ["--tw-ring-color" as string]: ACCENT }}
                />
                {showTypewriter && (
                  <div
                    aria-hidden
                    className="pointer-events-none absolute inset-0 flex items-center justify-center text-[15px] text-white/30"
                  >
                    <span>{typed}</span>
                    <span className="animate-cursor ml-0.5 inline-block h-[1.1em] w-px translate-y-px bg-white/40" />
                  </div>
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
              <div className="mx-auto mt-6 grid max-w-sm grid-cols-2 gap-2.5">
                {NICHES.map((n) => {
                  const active = niche === n;
                  return (
                    <button
                      key={n}
                      type="button"
                      onClick={() => setNiche(n)}
                      className="rounded-2xl border px-3 py-3 text-sm font-semibold transition-all active:scale-[0.97]"
                      style={{
                        borderColor: active ? ACCENT : "rgba(255,255,255,0.1)",
                        backgroundColor: active ? ACCENT_TINT : "#1c1c1e",
                        color: active ? "#ffffff" : "rgba(255,255,255,0.6)",
                      }}
                    >
                      {n}
                    </button>
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
                {GOALS.map((g) => {
                  const active = goal === g.id;
                  return (
                    <button
                      key={g.id}
                      type="button"
                      onClick={() => setGoal(g.id)}
                      className="flex w-full items-center justify-between rounded-2xl border px-4 py-3.5 text-left transition-all active:scale-[0.99]"
                      style={{
                        borderColor: active ? ACCENT : "rgba(255,255,255,0.1)",
                        backgroundColor: active ? ACCENT_TINT : "#1c1c1e",
                      }}
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
                    </button>
                  );
                })}
              </div>
            </>
          )}

          {key === "finish" && (
            <>
              <div
                className="animate-generate mx-auto grid h-16 w-16 place-items-center rounded-full"
                style={{ backgroundColor: ACCENT_TINT }}
              >
                <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke={ACCENT} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d="M20 6L9 17l-5-5" />
                </svg>
              </div>
              <h1 className="mt-6 text-3xl font-extrabold tracking-tight text-white">
                You&apos;re all set
              </h1>
              <p className="mx-auto mt-3 max-w-xs text-[15px] leading-relaxed text-white/50">
                Everything&apos;s ready. Let&apos;s make your first scroll-stopping
                slideshow.
              </p>
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
                    : "Go to dashboard"
                  : primaryLabel}
              </button>
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
