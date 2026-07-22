// Static options powering the dashboard generator UI. This is mockup data only —
// no generation is wired up yet. Gradient class strings are written out in full
// so Tailwind's scanner picks them up.

export const LAYOUTS = [
  { value: "title-captions", label: "Title slide + captions" },
  { value: "captions-only", label: "Captions only" },
  { value: "hook-bullets", label: "Hook + bullet points" },
  { value: "quote-cards", label: "Quote cards" },
];

export const SLIDE_COUNTS = [3, 4, 5, 6, 7, 8, 9, 10];
export const SLIDESHOW_COUNTS = [1, 2, 3, 5];

// Post goals — a settings-row dropdown, appended to the caption model prompt.
// Shared so the composer and the /api/suggest planner validate against one list.
export const GOALS = ["Grow followers", "Drive sales", "Educate", "Entertain"];

export const GENERATOR_NICHES = [
  { value: "gym", label: "Gym & Fitness" },
  { value: "food", label: "Food & Dining" },
  { value: "fashion", label: "Fashion & Apparel" },
  { value: "realestate", label: "Real Estate" },
  { value: "beauty", label: "Beauty & Skincare" },
  { value: "cafe", label: "Cafe & Coffee" },
  { value: "ecommerce", label: "Ecommerce / Product" },
  // Generalized catch-all for niches we don't preset — no fixed collection, so
  // image selection leans on the live Pexels search + the prompt keywords.
  { value: "other", label: "Other" },
];

export interface ImageModel {
  id: string;
  name: string;
  desc: string;
  badge?: string;
}

export const IMAGE_MODELS: ImageModel[] = [
  { id: "standard", name: "Standard", desc: "Fast — great for most slideshows", badge: "Default" },
  { id: "ultra", name: "Ultra", desc: "Highest quality, uses more credits per slide" },
];

export interface Collection {
  id: string;
  name: string;
  count: number;
  gradient: string;
  emojis: [string, string, string, string];
}

export const COLLECTIONS: Collection[] = [
  { id: "gym", name: "Gym & Fitness", count: 48, gradient: "from-indigo-600 to-sky-500", emojis: ["🏋️", "🔥", "💪", "🏃"] },
  { id: "food", name: "Food & Dining", count: 52, gradient: "from-amber-600 to-rose-500", emojis: ["🍔", "🍜", "🥗", "🍰"] },
  { id: "fashion", name: "Fashion & Apparel", count: 60, gradient: "from-fuchsia-600 to-violet-500", emojis: ["👗", "👜", "🕶️", "👟"] },
  { id: "realestate", name: "Real Estate", count: 40, gradient: "from-teal-600 to-emerald-500", emojis: ["🏡", "🔑", "🏙️", "🛋️"] },
  { id: "beauty", name: "Beauty & Skincare", count: 50, gradient: "from-rose-500 to-pink-400", emojis: ["💄", "🧴", "💅", "✨"] },
  { id: "luxury", name: "Dark Luxury", count: 30, gradient: "from-zinc-700 to-amber-600", emojis: ["⌚", "🥂", "💎", "🖤"] },
  { id: "cafe", name: "Cafe & Coffee", count: 28, gradient: "from-amber-800 to-orange-500", emojis: ["☕", "🥐", "🫖", "🍪"] },
  { id: "tech", name: "Tech & Gadgets", count: 36, gradient: "from-cyan-600 to-blue-600", emojis: ["💻", "📱", "🎧", "⌨️"] },
  { id: "travel", name: "Travel & Hospitality", count: 44, gradient: "from-sky-500 to-indigo-500", emojis: ["✈️", "🏝️", "🧳", "🗺️"] },
];

export interface Style {
  id: string;
  name: string;
  gradient: string;
  emoji: string;
}

export const STYLES: Style[] = [
  { id: "photo", name: "Realistic Photography", gradient: "from-slate-600 to-slate-900", emoji: "📷" },
  { id: "studio", name: "Studio Product", gradient: "from-zinc-500 to-zinc-800", emoji: "🪞" },
  { id: "bold", name: "Bold & Minimal", gradient: "from-indigo-600 to-fuchsia-600", emoji: "🔲" },
  { id: "anime", name: "Anime / Ghibli", gradient: "from-sky-500 to-emerald-400", emoji: "🌸" },
  { id: "vintage", name: "Vintage Film", gradient: "from-amber-700 to-rose-700", emoji: "🎞️" },
  { id: "render", name: "3D Render", gradient: "from-violet-600 to-cyan-500", emoji: "🧊" },
];

export const NICHE_SUGGESTIONS: Record<string, string[]> = {
  gym: [
    "Why our gym is different",
    "5 mistakes beginners make in the gym",
    "Morning workout routine that changed my life",
    "Best exercises for fat loss at home",
    "What I eat in a day as a personal trainer",
    "Signs you're overtraining and how to fix it",
    "3 exercises to build a bigger chest fast",
    "The truth about six-pack abs",
    "Why most people quit the gym in January",
    "Results after 30 days of consistency",
  ],
  food: [
    "New menu launch",
    "Behind the scenes of our kitchen",
    "Our most popular dish and why people love it",
    "5 dishes you have to try before you die",
    "How we source our ingredients locally",
    "The secret ingredient in our signature sauce",
    "What makes our food different from everyone else",
    "A full day in our restaurant",
  ],
  fashion: [
    "Summer outfits under $50",
    "3 wardrobe staples you need right now",
    "How to style one piece 5 different ways",
    "The fashion trend you're sleeping on",
    "Building a capsule wardrobe from scratch",
    "How to dress for your body type",
    "Our best-selling pieces this season",
    "Behind the scenes of our latest drop",
  ],
  realestate: [
    "3 reasons to book a viewing",
    "What to look for when buying your first home",
    "The neighborhood nobody is talking about",
    "5 things your real estate agent won't tell you",
    "Before and after renovation that shocked everyone",
    "How to negotiate the best price on a home",
    "Investment properties under $300k",
    "This property won't last — here's why",
  ],
  beauty: [
    "Morning skincare routine for glowing skin",
    "Products that actually cleared my skin",
    "5 skincare mistakes dermatologists hate",
    "Best dupes for luxury skincare products",
    "The routine that transformed my skin in 30 days",
    "Under $20 products that outperform luxury",
    "What no one tells you about retinol",
    "How I fixed my skin barrier in 2 weeks",
  ],
  luxury: [
    "What separates luxury from everything else",
    "The details most people never notice",
    "Why our clients keep coming back",
    "Behind the craft of what we create",
    "The standard we hold ourselves to",
    "An experience, not just a product",
    "Where refinement meets excellence",
    "What true quality actually looks like",
  ],
  cafe: [
    "Our most Instagrammed drink",
    "Why we only use single-origin beans",
    "5 coffees to try if you hate black coffee",
    "A full day inside our cafe",
    "How we perfect our espresso every morning",
    "The story behind our signature drink",
    "Why locals choose us every single morning",
    "Meet the baristas behind the bar",
  ],
  tech: [
    "The gadget that changed how I work",
    "5 tech products worth every penny",
    "My entire desk setup revealed",
    "The app nobody is talking about",
    "How this device saved me 2 hours a day",
    "Honest review after 6 months of daily use",
    "Best tech under $100 this year",
    "The upgrade I should have made way sooner",
  ],
  travel: [
    "Hidden gem destinations you need to visit",
    "How to travel for less than you think",
    "This hotel ruined every other hotel for me",
    "5 things to do here in 48 hours",
    "Why this destination is criminally underrated",
    "What to pack for a 2-week trip",
    "The travel mistake I will never make again",
    "How we make every guest feel at home",
  ],
};

export const PINNED_TEMPLATES = [
  "Why our gym is different",
  "5 mistakes beginners make in the gym",
  "Morning workout routine that changed my life",
  "Best exercises for fat loss at home",
  "What I eat in a day as a personal trainer",
  "Signs you're overtraining and how to fix it",
  "3 exercises to build a bigger chest fast",
  "The truth about six-pack abs",
  "Why most people quit the gym in January",
  "New menu launch",
  "Behind the scenes of our kitchen",
  "Our most popular dish and why people love it",
  "5 dishes you have to try before you die",
  "How we source our ingredients locally",
  "The secret ingredient in our signature sauce",
  "3 reasons to book a viewing",
  "What to look for when buying your first home",
  "The neighborhood nobody is talking about",
  "5 things your real estate agent won't tell you",
  "Before and after renovation that shocked everyone",
  "Summer outfits under $50",
  "3 wardrobe staples you need right now",
  "How to style one piece 5 different ways",
  "The fashion trend you're sleeping on",
  "Morning skincare routine for glowing skin",
  "Products that actually cleared my skin",
  "5 skincare mistakes dermatologists hate",
  "Best dupes for luxury skincare products",
  "Our most Instagrammed drink",
  "Why we only use single-origin beans",
  "5 coffees to try if you hate black coffee",
  "Why our customers keep coming back",
  "3 problems our product solves instantly",
  "What makes us different from the big brands",
  "Customer reviews that made our team cry",
  "Day in the life of our founder",
  "How we went from 0 to 10k followers",
  "The truth about our industry nobody says",
  "5 things I wish I knew before starting",
  "How we built this from scratch",
  "Things our competitors don't want you to know",
  "The biggest myth in our niche",
  "Our origin story in 60 seconds",
  "The question we get asked every single day",
  "Results after 30 days of consistency",
  "What we actually do differently",
  "5 facts about us you didn't know",
  "Unpopular opinion about our industry",
  "The mistake that almost cost us everything",
  "Why most people fail at this",
];
