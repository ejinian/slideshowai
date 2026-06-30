// Hardcoded sample content powering the landing-page demo. This is illustrative
// only — the real app generates captions with the Claude API and pulls images
// from the product library. Keeping it here makes the demo a single source of
// truth that the <NicheDemo> client component reads from.

export type NicheId = "gym" | "diet" | "business" | "saas";

export interface Niche {
  id: NicheId;
  label: string;
  emoji: string;
}

export interface DemoSlide {
  /** Path to a placeholder background image under /public/demo. */
  image: string;
  /** Bold overlay caption, written in a TikTok Photo Mode voice. */
  caption: string;
}

export const NICHES: Niche[] = [
  { id: "gym", label: "Gym", emoji: "🏋️" },
  { id: "diet", label: "Diet", emoji: "🥗" },
  { id: "business", label: "Business", emoji: "💼" },
  { id: "saas", label: "SaaS", emoji: "⚡" },
];

export const DEFAULT_NICHE: NicheId = "gym";

export const DEMO_SLIDES: Record<NicheId, DemoSlide[]> = {
  gym: [
    { image: "/library/gym/gym-01.jpg", caption: "POV: you finally found a gym that feels like home" },
    { image: "/library/gym/gym-16.jpg", caption: "24/7 access. No contracts. No judgment." },
    { image: "/library/gym/gym-10.jpg", caption: "Coaching that actually moves the needle 💪" },
    { image: "/library/gym/gym-17.jpg", caption: "Your first week is on us → link in bio" },
  ],
  diet: [
    { image: "/demo/diet-1.jpeg", caption: "3 reasons you're not as shredded as you want to be" },
    { image: "/demo/diet-2.jpeg", caption: "1. You eat out too much — home-cooked protein wins every time" },
    { image: "/demo/diet-3.jpeg", caption: "2. You're under-eating protein. Hit 1g per pound, every day." },
    { image: "/demo/diet-4.jpeg", caption: "3. No plan = no progress. Get a done-for-you meal plan → link in bio" },
  ],
  business: [
    { image: "/demo/golf-1.jpeg", caption: "3 reasons you're not getting better at golf" },
    { image: "/demo/golf-2.jpeg", caption: "1. Your setup is off — bad posture and alignment kill the shot before you swing" },
    { image: "/demo/golf-3.jpeg", caption: "2. No feedback loop. A coach fixes in one lesson what YouTube can't in a year → link in bio" },
    { image: "/demo/golf-4.jpeg", caption: "3. You beat balls with no plan. Practice with structure → book a lesson, link in bio" },
  ],
  saas: [
    { image: "/demo/saas-1.jpeg", caption: "3 things that finally made me productive (after years of pretending)." },
    { image: "/demo/saas-2.jpeg", caption: "1. I actually finished my to-do list — by putting it all in ONE place." },
    { image: "/demo/saas-3.jpeg", caption: "2. I track my focus instead of guessing where my time goes." },
    { image: "/demo/saas-4.jpeg", caption: "3. I take 10 minutes to reflect on my day. → It's all in [App]. Link in bio, free to start." },
  ],
};
