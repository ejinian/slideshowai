import type { TrendingSlideshow } from "@/lib/mock-data";

/* ── Trend topics ────────────────────────────────────────────────────────────
   TikTok Studio's Inspiration page is TOPIC-first: a ranked table of subjects
   with aggregate views, a momentum sparkline, and the posts that prove it.

   We aggregate by FORMAT (the post's hook structure) rather than by subject.
   Two reasons: it's the unit a user actually copies into the composer, and it's
   honest with our sample size — we keep ~30 posts per niche, so clustering by
   subject would yield one-post "topics" with tiny view totals. Formats recur
   across posts, so the totals and the sparkline mean something.

   The real AI label (`hookType`, written by the ingest curation pass) always
   wins. `inferFormat` only fills in when it's missing — the curation pass fails
   open without OPENAI_API_KEY, and the bundled sample data has no labels at
   all, so without a fallback every post would collapse into one "Other" row.
   --------------------------------------------------------------------------- */

export interface TrendTopic {
  /** Stable slug, used as a React key and for detail lookup. */
  id: string;
  label: string;
  rank: number;
  /** Sum of member posts' lifetime views — TikTok's "Views" column. */
  views: number;
  postCount: number;
  /** Members, biggest first. */
  posts: TrendingSlideshow[];
  /** Aggregate view history across refreshes (oldest → newest). Empty when no
   *  member has been snapshotted twice — we render a flat marker, not a fake line. */
  history: number[];
  /** Combined live climb rate (views/hr) across members that have one. */
  risingVph: number | null;
  /** Niche labels represented, most common first. */
  niches: string[];
  /** Percent change across the aggregate history, or null when unknown. */
  changePct: number | null;
  /** Evidence tier — see `tierOf`. 0 = proven, 1 = solid, 2 = thin. */
  tier: 0 | 1 | 2;
}

/** ≥ this many posts = a proven format; ranked above everything else. */
export const PROVEN_POSTS = 10;
/** ≤ this many posts is a single outlier, not a trend; ranked last. */
export const THIN_POSTS = 2;

/* Ranking is evidence-first, then views. A format riding 12 posts is a real
   pattern you can copy; one 4.8M post is a lottery ticket that says nothing
   about the format. Sorting purely by summed views let a single viral outlier
   top the table, which is the same "why is THIS #1?" feeling the old
   lifetime-views ranking produced. Thin rows are demoted, never hidden — they
   can still be the first sign of something new. */
export function tierOf(postCount: number): 0 | 1 | 2 {
  if (postCount >= PROVEN_POSTS) return 0;
  if (postCount <= THIN_POSTS) return 2;
  return 1;
}

const FORMAT_RULES: [RegExp, string][] = [
  [/\bpov\b/i, "POV framing"],
  [
    /(day \d+ ?(vs|→|to)|before (and |vs )?after|transformation|\d+ ?(days?|weeks?|months?) later)/i,
    "Transformation arc",
  ],
  [/(\$\d|under \$|\bprice[sd]?\b|how much|costs?\b)/i, "Price reveal"],
  [/\b(quit|replaced|swapped|ditched|switched from)\b/i, "Swap / replacement"],
  [
    /(\d ?- ?\d before my|morning routine|night routine|\broutine\b)/i,
    "Routine walkthrough",
  ],
  [/(signs?\b|red flags?|it'?s time to)/i, "Symptom checklist"],
  [/(rating|ranked|ranking|tier list|honest review)/i, "Rating / ranking"],
  [/(how (to|i)\b|tutorial|step[s -]by[- ]step|\bsteps?\b)/i, "How-to"],
  [
    /(behind the scenes|\bbts\b|restock|packag(e|ing)|packing|tour\b|day in (the|my) life)/i,
    "Behind the scenes",
  ],
  [/(gatekeep|nobody tells you|secret|insider)/i, "Insider secret"],
  [
    /^\s*\d+|\b\d+\s+(things|ways|reasons|tips|lifts|exercises|items|mistakes|foods|habits|rules)\b/i,
    "Numbered listicle",
  ],
  [/\?\s*$/, "Question hook"],
];

/** Coarse format label inferred from a post's hook. Deterministic, no API. */
export function inferFormat(title: string): string {
  for (const [re, label] of FORMAT_RULES) if (re.test(title)) return label;
  return "Straight hook";
}

export function topicLabel(post: TrendingSlideshow): string {
  const ai = post.hookType?.trim();
  return ai && ai.length > 0 ? ai : inferFormat(post.title);
}

const slug = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "topic";

// Right-align member histories to the longest one (padding the left with each
// member's earliest known value) so index-wise addition compares like with
// like. Members are snapshotted a different number of times, so summing raw
// arrays by index would blend "week 1 of post A" into "week 3 of post B".
function aggregateHistory(posts: TrendingSlideshow[]): number[] {
  const series = posts
    .map((p) => p.history)
    .filter((h): h is number[] => Array.isArray(h) && h.length >= 2);
  if (series.length === 0) return [];
  const len = Math.max(...series.map((h) => h.length));
  const out = new Array<number>(len).fill(0);
  for (const h of series) {
    const pad = len - h.length;
    for (let i = 0; i < len; i++) out[i] += i < pad ? h[0] : h[i - pad];
  }
  return out;
}

/** Group posts into format-topics, ranked by evidence tier then total views. */
export function buildTopics(posts: TrendingSlideshow[]): TrendTopic[] {
  const groups = new Map<string, TrendingSlideshow[]>();
  for (const p of posts) {
    const label = topicLabel(p);
    const list = groups.get(label);
    if (list) list.push(p);
    else groups.set(label, [p]);
  }

  const topics: Omit<TrendTopic, "rank">[] = [...groups.entries()].map(
    ([label, members]) => {
      const sorted = [...members].sort((a, b) => b.views - a.views);
      const history = aggregateHistory(sorted);
      const rates = sorted
        .map((p) => p.risingVph)
        .filter((v): v is number => typeof v === "number");
      const nicheCounts = new Map<string, number>();
      for (const p of sorted) {
        const n = p.nicheLabel ?? p.niche;
        nicheCounts.set(n, (nicheCounts.get(n) ?? 0) + 1);
      }
      const first = history[0];
      return {
        id: slug(label),
        label,
        views: sorted.reduce((sum, p) => sum + p.views, 0),
        postCount: sorted.length,
        posts: sorted,
        history,
        risingVph: rates.length
          ? rates.reduce((a, b) => a + b, 0)
          : null,
        niches: [...nicheCounts.entries()]
          .sort((a, b) => b[1] - a[1])
          .map(([n]) => n),
        changePct:
          history.length >= 2 && first > 0
            ? ((history[history.length - 1] - first) / first) * 100
            : null,
        tier: tierOf(sorted.length),
      };
    },
  );

  // Evidence tier first, then views inside each tier (see `tierOf`).
  return topics
    .sort(
      (a, b) =>
        a.tier - b.tier ||
        b.views - a.views ||
        b.postCount - a.postCount,
    )
    .map((t, i) => ({ ...t, rank: i + 1 }));
}
