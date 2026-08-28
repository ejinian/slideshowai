import OpenAI from "openai";
import sharp from "sharp";
import { createAdminClient } from "@/utils/supabase/admin";
import type { RunLogger } from "./diagnostics";

// Live, on-demand stock sourcing for the LIBRARY/stock flow. Instead of matching
// captions against a frozen offline pool (which may lack the exact subject — e.g.
// no bench-press photos in the "gym" collection), we search Pexels AT RUNTIME
// with each slide's own keywords, then let a vision judge pick the result that
// actually DEPICTS the caption — or flag "none fit" (-1) so the caller can
// escalate to AI generation. Pexels is license-clean for commercial posts.

const PER_SLIDE = 4; // Pexels results per slide shown to the judge
const AESTHETIC_EXTRA = 2; // extra results from the "<subject> aesthetic" query variant
const PINTEREST_PER_SLIDE = 3; // curated-pool candidates per slide
const THUMB_W = 448;
const DL_CONCURRENCY = 8;

export interface LiveIntent {
  caption: string;
  keywords: string[];
}

export interface LiveResult {
  /** vision-approved photo that depicts the caption, or null (no good fit). */
  approved: Buffer | null;
  /** best-effort top Pexels result, used when AI-gen isn't available. */
  fallback: Buffer | null;
}

interface Cand {
  url: string;
  buf?: Buffer;
  thumb?: string;
  /** "pinterest" = curated aesthetic pool (own storage); else live Pexels. */
  origin: "pexels" | "pinterest";
  /** Pexels photographer — used to cap same-shoot repeats within a deck. */
  photographerId?: number | null;
}

/* ── Curated aesthetic pool (Pinterest ingest, scripts/ingest-pinterest.mjs) ──
   These live in our own `library` bucket, so candidates cost nothing to fetch.
   Vibe over subject: keyword-matched rows first, random pool fills the rest —
   the strict judge still decides whether one actually fits the caption. */

interface PoolRow {
  url: string;
  alt: string | null;
  query: string | null;
}

async function pinterestPool(collection: string | undefined): Promise<PoolRow[]> {
  if (!collection || collection === "other") return [];
  try {
    const admin = createAdminClient();
    const { data } = await admin
      .from("library_images")
      .select("url, alt, query")
      .eq("collection", collection)
      .eq("source", "pinterest")
      .limit(400);
    return (data as PoolRow[] | null) ?? [];
  } catch {
    return [];
  }
}

function poolCandidates(pool: PoolRow[], intent: LiveIntent): string[] {
  if (pool.length === 0) return [];
  const kw = (intent.keywords ?? []).map((k) => k.toLowerCase()).filter(Boolean);
  const matches = pool.filter((r) => {
    const hay = `${r.alt ?? ""} ${r.query ?? ""}`.toLowerCase();
    return kw.some((k) => hay.includes(k));
  });
  const picked: string[] = matches.slice(0, PINTEREST_PER_SLIDE).map((r) => r.url);
  // Fill with random pool picks so vibe slides (hooks/CTAs, no keyword hits)
  // still see the aesthetic pool.
  while (picked.length < PINTEREST_PER_SLIDE && picked.length < pool.length) {
    const r = pool[Math.floor(Math.random() * pool.length)];
    if (!picked.includes(r.url)) picked.push(r.url);
  }
  return picked;
}

// Words that mark a keyword as art direction rather than a searchable subject.
// The copy prompt bans these now, but prompts leak — measured runs produced
// "side-view of lifter arching back" and "fatigue shown on face", which glued
// into queries Pexels answers with nothing relevant.
const NON_SEARCH_WORDS =
  /\b(view|close-?up|shot|angle|shown|showing|exaggerated|dramatic|cinematic|mood|moody|focus|blurred|struggling|frustrated|confusion|fatigue)\b/i;

function searchable(k: string): boolean {
  return !NON_SEARCH_WORDS.test(k) && k.split(/\s+/).length <= 4;
}

function slideQuery(intent: LiveIntent, niche: string): string {
  const kw = (intent.keywords ?? []).map((k) => k.trim()).filter(Boolean);
  // The first SEARCHABLE keyword is the query (e.g. "incline dumbbell press").
  // Joining two multi-word phrases made incoherent queries ("empty barbell
  // rack people struggling with weights"), which is what drove the judge's
  // no-candidate-depicts rate to ~half the deck.
  const subject = kw.find(searchable) ?? kw[0] ?? "";
  const extra = kw.find((k) => k !== subject && searchable(k) && k.split(/\s+/).length <= 2);
  const q = subject.split(/\s+/).length <= 2 && extra ? `${subject} ${extra}` : subject;
  return q || niche || "lifestyle";
}

interface PexelsHit {
  url: string;
  photographerId: number | null;
}

async function pexelsSearch(query: string): Promise<PexelsHit[]> {
  const key = process.env.PEXELS_API_KEY;
  if (!key) return [];
  try {
    const res = await fetch(
      `https://api.pexels.com/v1/search?query=${encodeURIComponent(
        query,
      )}&orientation=portrait&per_page=${PER_SLIDE}`,
      { headers: { Authorization: key }, signal: AbortSignal.timeout(12_000) },
    );
    if (!res.ok) return [];
    const json = (await res.json()) as {
      photos?: {
        photographer_id?: number;
        src?: { large2x?: string; large?: string; portrait?: string };
      }[];
    };
    return (json.photos ?? [])
      .map((p) => ({
        url: p.src?.large2x || p.src?.large || p.src?.portrait || "",
        photographerId:
          typeof p.photographer_id === "number" ? p.photographer_id : null,
      }))
      .filter((p) => p.url);
  } catch {
    return [];
  }
}

async function downloadAll(urls: string[]): Promise<Map<string, Buffer>> {
  const out = new Map<string, Buffer>();
  const queue = [...new Set(urls)];
  await Promise.all(
    Array.from({ length: DL_CONCURRENCY }, async () => {
      for (;;) {
        const url = queue.shift();
        if (!url) return;
        try {
          const r = await fetch(url, { signal: AbortSignal.timeout(15_000) });
          if (r.ok) out.set(url, Buffer.from(await r.arrayBuffer()));
        } catch {
          /* skip */
        }
      }
    }),
  );
  return out;
}

async function thumbnail(buf: Buffer): Promise<string | null> {
  try {
    const o = await sharp(buf)
      .resize({ width: THUMB_W, withoutEnlargement: true })
      .jpeg({ quality: 64 })
      .toBuffer();
    return `data:image/jpeg;base64,${o.toString("base64")}`;
  } catch {
    return null;
  }
}

const SYSTEM =
  "You are a TikTok art director. For each slide you get its caption and a few " +
  "candidate photos. Return, per slide, the candidate that best fits — or -1.\n" +
  "• A slide you return -1 for is REPLACED BY A PURPOSE-GENERATED image that " +
  "depicts the caption exactly, so -1 is a good outcome, not a failure. Approve " +
  "a candidate ONLY when you are near-certain (99%) it genuinely depicts what " +
  "the caption describes. When in doubt, return -1.\n" +
  "• The photo must show the caption's subject or activity actually HAPPENING. " +
  "Equipment, empty settings, and adjacent shots are NOT matches: a rack of " +
  "dumbbells does not depict 'bicep curls' — a person must be performing the " +
  "movement or activity the caption names. Technique details (grip width, " +
  "tempo, wrist angle) do not need to be visible, but the core activity does: " +
  "'ignoring the negatives on curls' needs someone actually curling, not " +
  "someone holding dumbbells. A photo with NO person in it can only match a " +
  "caption that is about the object or place itself — it never matches a " +
  "caption about doing, training, using, or changing something.\n" +
  "• A hook or call-to-action still needs a photo of the DECK's subject in " +
  "action — 'why your biceps aren't growing' needs someone training arms, not " +
  "a generic gym scene. Only a caption with genuinely no subject at all may " +
  "take a strong on-theme photo.\n" +
  "• DISQUALIFY any candidate with visible baked-in text, typography, captions, " +
  "watermarks, or logos — we overlay our own caption text, so a text-bearing " +
  "background is never acceptable, even if it fits the topic. Treat those " +
  "candidates as if they weren't offered.\n" +
  "• VARIETY ACROSS THE DECK: you see every slide's candidates at once. Avoid " +
  "picking photos that are obviously from the same photoshoot (same people, same " +
  "room, same styling) for more than one slide — a single-shoot deck reads as " +
  "stock spam; a varied deck reads authentic.\n" +
  "• The 'should show' line for each slide describes the photo that slide needs. " +
  "Judge every candidate against IT, not just against the caption's general " +
  "topic. A caption about protein-rich meals whose slide should show 'grilled " +
  "chicken, meal prep, kitchen counter' is NOT served by a gym photo, however " +
  "good that gym photo is.\n" +
  "• Candidates marked (curated) come from a hand-picked aesthetic pool with the " +
  "candid, non-stocky look that performs on TikTok. Prefer a curated candidate " +
  "ONLY when it depicts the slide's subject as well as the stock one does. The " +
  "curated pool is chosen for VIBE, not for subject matter, so it is often " +
  "off-subject — never let its look outweigh whether it actually shows the right " +
  "thing.\n" +
  "• THE DECK'S SUBJECT OVERRULES THE SLIDE'S WORDS. You are told the subject up " +
  "front. A photo must fit BOTH the caption AND that subject — matching the " +
  "caption's words while contradicting the subject is a REJECT, not a pick. This " +
  "matters most for words that mean different things in different domains: on a " +
  "SOCCER deck, '1v1 defending' must never get an American-football photo; " +
  "'football' means soccer, a 'court' is not a 'pitch', 'boxing' is not MMA. When " +
  "a candidate would only make sense in a different sport, industry or context " +
  "than the deck's subject, treat it as disqualified.\n" +
  "Remember: a generated image that matches the caption beats a real photo " +
  "that doesn't. If no candidate clearly depicts the caption, return -1.";

const PICKS_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["picks"],
  properties: { picks: { type: "array", items: { type: "integer" } } },
} as const;

// Second-pass audit of the picker's choices (2026-08-27). The 30+-image ranking
// call is noisy — the same deck flips between approve-all and reject-most run to
// run, and prompt strictness alone couldn't stop equipment-only shots slipping
// through (a floor of dumbbells approved for "mix it up and go heavy"). A
// binary check on ONE image per slide is a far easier task, so it holds the
// 99%-sure bar mechanically: any "no" flips that slide to -1 → the AI fill.
const VERIFY_SYSTEM =
  "You audit photo choices for TikTok slides. For each slide you get its " +
  "caption and the ONE photo chosen for it. Answer per slide: does the photo " +
  "CLEARLY depict the caption's specific subject and activity? The bar is " +
  "near-certainty — a viewer must instantly see the caption's subject in the " +
  "photo.\n" +
  "• Related equipment or an empty setting without the activity happening is " +
  "NO: dumbbells on the floor do not depict 'going heavy on curls'.\n" +
  "• A photo with no person in it is NO for any caption about doing, " +
  "training, using, or changing something.\n" +
  "• Visible baked-in text, typography, or watermarks is NO.\n" +
  "• A slide you fail gets a purpose-generated image instead, so failing is " +
  "cheap and a mismatched photo is expensive. When unsure, answer no.\n" +
  "Slides answered 'no' are replaced; answer honestly per slide.";

const VERIFY_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["verdicts"],
  properties: { verdicts: { type: "array", items: { type: "boolean" } } },
} as const;

/** Audit approved picks one image at a time; false = demote that slide to -1.
 *  Fails open (all true) so a broken audit never degrades below old behavior. */
async function verifyPicks(
  openai: OpenAI,
  items: { caption: string; thumb: string }[],
  faceless = false,
): Promise<boolean[]> {
  if (items.length === 0) return [];
  try {
    const content: Array<
      | { type: "text"; text: string }
      | { type: "image_url"; image_url: { url: string; detail: "low" } }
    > = [];
    if (faceless) {
      content.push({
        type: "text",
        text:
          "FILL RULE for every slide below: this image fills a gap in a " +
          "creator's PERSONAL photo deck, so answer NO for any photo " +
          "containing a person, face, or body — they would read as a " +
          "stranger. A subject-only photo (the meal itself, the object, the " +
          "place) is a YES when it shows the caption's subject; do NOT " +
          "require a person performing the action here.",
      });
    }
    items.forEach((it, i) => {
      content.push({
        type: "text",
        text: `Slide ${i} — caption: "${it.caption}". Chosen photo:`,
      });
      content.push({
        type: "image_url",
        image_url: { url: it.thumb, detail: "low" },
      });
    });
    content.push({
      type: "text",
      text: `Return verdicts: one boolean per slide in order (0..${items.length - 1}).`,
    });
    const completion = await openai.chat.completions.create({
      model: "gpt-4o",
      temperature: 0,
      messages: [
        { role: "system", content: VERIFY_SYSTEM },
        { role: "user", content },
      ],
      response_format: {
        type: "json_schema",
        json_schema: { name: "verdicts", strict: true, schema: VERIFY_SCHEMA },
      },
    });
    const parsed = JSON.parse(
      completion.choices[0]?.message?.content ?? "{}",
    ) as { verdicts?: boolean[] };
    return items.map((_, i) => parsed.verdicts?.[i] !== false);
  } catch {
    return items.map(() => true);
  }
}

/**
 * For each slide, search Pexels with its keywords and have a vision judge pick
 * the result that depicts the caption (or flag -1 = generate instead). Returns
 * null when PEXELS_API_KEY is absent so the caller falls back to the library.
 * `slideshows` is parallel to the requested decks (usually one).
 */
export async function selectLiveBackgrounds(
  slideshows: LiveIntent[][],
  niche: string,
  collection?: string,
  diag?: RunLogger | null,
  /** The deck's actual subject (the user's prompt). Without it the judge sees
   *  each caption in isolation and picks photos that match the words but not the
   *  topic — a soccer deck got an American-football photo for "1v1 defending". */
  topic?: string,
  /** Personal-deck gap fill (collection pools): every image must be a
   *  subject-only cutaway with NO people — anyone in the photo reads as a
   *  stranger inside the creator's own deck. Reverses the judge's no-person
   *  rule for these slides. */
  faceless = false,
): Promise<LiveResult[][] | null> {
  if (!process.env.PEXELS_API_KEY) {
    if (diag) {
      await diag.text(
        "04_stock_selection.txt",
        "PEXELS_API_KEY absent — live sourcing skipped, fell back to the frozen library (imageSelection.ts).",
      );
    }
    return null;
  }

  // 1) Per slide, in parallel: the subject query, an "<subject> aesthetic"
  //    variant (de-stockifies results), and curated-pool picks.
  const flat: { ss: number; i: number; intent: LiveIntent }[] = [];
  slideshows.forEach((slides, ss) =>
    slides.forEach((intent, i) => flat.push({ ss, i, intent })),
  );
  const pool = await pinterestPool(collection);
  const perSlide = await Promise.all(
    flat.map(async (f) => {
      const q = slideQuery(f.intent, niche);
      const [plain, aesthetic] = await Promise.all([
        pexelsSearch(q),
        pexelsSearch(`${q} aesthetic`),
      ]);
      const plainUrls = new Set(plain.map((p) => p.url));
      const pexels = [
        ...plain,
        ...aesthetic
          .filter((p) => !plainUrls.has(p.url))
          .slice(0, AESTHETIC_EXTRA),
      ];
      return { pexels, pinterest: poolCandidates(pool, f.intent) };
    }),
  );

  // 2) Download every candidate once.
  const downloaded = await downloadAll(
    perSlide.flatMap((s) => [...s.pinterest, ...s.pexels.map((p) => p.url)]),
  );
  // Curated pool first: when two candidates fit equally, the judge's pick
  // order naturally favors the aesthetic pool.
  const candsPerSlide: Cand[][] = perSlide.map((s) =>
    [
      ...s.pinterest.map((u) => ({ url: u, origin: "pinterest" as const })),
      ...s.pexels.map((p) => ({
        url: p.url,
        photographerId: p.photographerId,
        origin: "pexels" as const,
      })),
    ]
      .filter((c) => downloaded.has(c.url))
      .map((c) => ({ ...c, buf: downloaded.get(c.url) as Buffer })),
  );

  // 3) Thumbnail candidates for the judge.
  await Promise.all(
    candsPerSlide.flat().map(async (c) => {
      c.thumb = (await thumbnail(c.buf as Buffer)) ?? undefined;
    }),
  );

  // 4) One vision call judges every slide's candidates.
  const picks = await judge(flat, candsPerSlide, topic ?? niche, faceless);

  // 5) Assemble. Deterministic same-shoot backstop: within one deck, never
  //    reuse an exact URL and cap any single Pexels photographer at 2 slides —
  //    Run 2 of the 2026-07-24 diagnostics had 4 of 6 slides from one dealership
  //    photoshoot (same models on slides 1/3/6), which reads as stock spam. The
  //    judge's variety instruction does the judgment; this is the hard floor.
  //    Swaps stay within the slide's own candidates and only fire when a
  //    non-repeat alternative exists, so behavior is unchanged when there are
  //    no repeats.
  const MAX_PER_PHOTOGRAPHER = 2;
  const results: LiveResult[][] = slideshows.map((slides) =>
    slides.map(() => ({ approved: null, fallback: null }) as LiveResult),
  );
  const usedUrls = new Map<number, Set<string>>();
  const photogCounts = new Map<number, Map<number, number>>();
  const audit: unknown[] = [];
  flat.forEach((f, idx) => {
    const urls = usedUrls.get(f.ss) ?? new Set<string>();
    usedUrls.set(f.ss, urls);
    const counts = photogCounts.get(f.ss) ?? new Map<number, number>();
    photogCounts.set(f.ss, counts);
    const isRepeat = (c: Cand | undefined): boolean =>
      !!c &&
      (urls.has(c.url) ||
        (c.photographerId != null &&
          (counts.get(c.photographerId) ?? 0) >= MAX_PER_PHOTOGRAPHER));

    const cands = candsPerSlide[idx].filter((c) => c.thumb);
    let p = picks[idx];
    let swapped = false;
    if (p != null && p >= 0 && p < cands.length && isRepeat(cands[p])) {
      const alt = cands.findIndex((c) => !isRepeat(c));
      if (alt >= 0) {
        p = alt;
        swapped = true;
      }
    }
    // Fallback stays the top PEXELS result: for a rejected specific subject,
    // "closest stock match" beats "random aesthetic shot" — but prefer the
    // first non-repeat one so fallbacks don't reintroduce the same shoot.
    const pexelsCands = cands.filter((c) => c.origin === "pexels");
    const firstPexels =
      pexelsCands.find((c) => !isRepeat(c)) ?? pexelsCands[0] ?? cands[0];
    const fallback = firstPexels?.buf ?? candsPerSlide[idx][0]?.buf ?? null;
    const approved =
      p != null && p >= 0 && p < cands.length ? (cands[p].buf ?? null) : null;
    results[f.ss][f.i] = { approved, fallback };
    // Register whichever image the deck will actually show.
    const shown = approved ? cands[p] : firstPexels;
    if (shown) {
      urls.add(shown.url);
      if (shown.photographerId != null) {
        counts.set(
          shown.photographerId,
          (counts.get(shown.photographerId) ?? 0) + 1,
        );
      }
    }
    audit.push({
      slideshow: f.ss,
      slide: f.i,
      caption: f.intent.caption,
      keywords: f.intent.keywords,
      pexelsQuery: slideQuery(f.intent, niche),
      candidatesReturned: candsPerSlide[idx].length,
      candidates: cands.map((c) => `[${c.origin}] ${c.url}`),
      judgePick: picks[idx],
      verdict:
        p < 0
          ? "NO CANDIDATE DEPICTS THE CAPTION → used best-effort fallback"
          : `approved candidate #${p} (${cands[p]?.origin ?? "?"})${
              swapped ? " — swapped off the judge's pick to break a same-shoot repeat" : ""
            }`,
      imageUsed: approved ? cands[p]?.url : (firstPexels?.url ?? null),
    });
  });
  if (diag) {
    await diag.json("04_stock_selection.json", audit);
  }
  return results;
}

const FACELESS_JUDGE_RULE =
  "FILL RULE — these images fill gaps in a creator's PERSONAL photo deck " +
  "(their own photos everywhere else), so ANY person in a photo reads as a " +
  "stranger inside their post. Pick ONLY photos with no people, faces, or " +
  "bodies: the subject alone (the meal on the table, the object, the place). " +
  "A photo containing a person is DISQUALIFIED even if it depicts the caption " +
  "perfectly. This REVERSES the usual no-person rule: here a subject-only " +
  "cutaway IS the correct match for an action caption ('every meal you wing…' " +
  "→ the takeout spread itself, nobody eating it).";

async function judge(
  flat: { intent: LiveIntent }[],
  candsPerSlide: Cand[][],
  /** What the whole deck is about — see the subject rule in SYSTEM. */
  subject: string,
  faceless = false,
): Promise<number[]> {
  const apiKey = process.env.OPENAI_API_KEY;
  const noJudge = flat.map(() => 0); // default: take Pexels' top result
  if (!apiKey || apiKey.includes("REPLACE_ME")) return noJudge;

  const content: Array<
    | { type: "text"; text: string }
    | { type: "image_url"; image_url: { url: string; detail: "low" } }
  > = [];
  if (subject?.trim()) {
    content.push({
      type: "text",
      text:
        `THE DECK'S SUBJECT IS: "${subject.trim()}". Every photo you pick must fit ` +
        `this subject as well as its slide's caption. A candidate that matches the ` +
        `caption's wording but belongs to a different sport, industry or context ` +
        `than this subject is disqualified.`,
    });
  }
  if (faceless) {
    content.push({ type: "text", text: FACELESS_JUDGE_RULE });
  }
  flat.forEach((f, g) => {
    const cands = candsPerSlide[g].filter((c) => c.thumb);
    content.push({
      type: "text",
      text:
        `Slide ${g} — caption: "${f.intent.caption}".` +
        (f.intent.keywords.length
          ? ` The photo for this slide should show: ${f.intent.keywords.join(", ")}.`
          : "") +
        ` Candidates:`,
    });
    cands.forEach((c, ci) => {
      content.push({
        type: "text",
        text: `${g}.${ci}${c.origin === "pinterest" ? " (curated)" : ""}:`,
      });
      content.push({ type: "image_url", image_url: { url: c.thumb as string, detail: "low" } });
    });
  });
  content.push({
    type: "text",
    text:
      "Return picks: one entry per slide in order (slide 0.." +
      `${flat.length - 1}), each the candidate index you are near-certain ` +
      "depicts that slide's caption, or -1 if none clearly do.",
  });

  try {
    const openai = new OpenAI({ apiKey, timeout: 35_000, maxRetries: 0 });
    const completion = await openai.chat.completions.create({
      model: "gpt-4o",
      // Deterministic: the same deck should judge the same way twice — approvals
      // near the 99% bar otherwise flip run-to-run.
      temperature: 0,
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content },
      ],
      response_format: {
        type: "json_schema",
        json_schema: { name: "picks", strict: true, schema: PICKS_SCHEMA },
      },
    });
    const parsed = JSON.parse(
      completion.choices[0]?.message?.content ?? "{}",
    ) as { picks?: number[] };
    const picks = parsed.picks ?? [];
    const norm = flat.map((_, g) =>
      Number.isInteger(picks[g]) ? picks[g] : 0,
    );
    // Second pass: audit each approved pick in isolation; failures demote to
    // -1 so the AI fill takes the slide. See VERIFY_SYSTEM for why.
    const audited: { g: number; caption: string; thumb: string }[] = [];
    norm.forEach((p, g) => {
      const cands = candsPerSlide[g].filter((c) => c.thumb);
      if (p >= 0 && p < cands.length) {
        audited.push({
          g,
          caption: flat[g].intent.caption,
          thumb: cands[p].thumb as string,
        });
      }
    });
    const verdicts = await verifyPicks(
      openai,
      audited.map(({ caption, thumb }) => ({ caption, thumb })),
      faceless,
    );
    verdicts.forEach((ok, i) => {
      if (!ok) norm[audited[i].g] = -1;
    });
    return norm;
  } catch {
    return noJudge;
  }
}

/* ── Single-slide re-pick (the editor's "Try another photo") ──────────────────
   Same search + vision judge as a full run, for ONE slide. Additive: nothing
   above this line changed, so generation behaves exactly as before.

   `exclude` is what makes the button worth pressing twice — without it the
   judge is deterministic enough to keep handing back the photo the user just
   rejected. Rejected URLs are carried by the client and skipped here. */

export interface RepickCandidate {
  /** Source URL, so the caller can exclude it if the user rejects this one. */
  url: string;
  /** Raw downloaded bytes, not yet fitted to a slide. */
  raw: Buffer;
}

/**
 * Candidates for ONE slide, best-first: the judge's pick, then the rest.
 *
 * Returns a RANKED LIST rather than a single image on purpose. The judge is
 * deterministic, so asking it for "another photo" hands back the photo already
 * on the slide — the caller needs a runner-up to fall through to when the top
 * pick is what the user is looking at.
 */
export async function repickSlideBackground(
  intent: LiveIntent,
  opts: {
    niche: string;
    collection?: string;
    /** The deck's subject, so the judge scores in context (see SYSTEM). */
    topic?: string;
    /** Source URLs the user has already rejected. */
    exclude?: string[];
  },
): Promise<{ ranked: RepickCandidate[]; judged: boolean } | null> {
  if (!process.env.PEXELS_API_KEY) return null;

  const q = slideQuery(intent, opts.niche);
  const [plain, aesthetic, pool] = await Promise.all([
    pexelsSearch(q),
    pexelsSearch(`${q} aesthetic`),
    pinterestPool(opts.collection),
  ]);

  const rejected = new Set(opts.exclude ?? []);
  const urls = [
    ...poolCandidates(pool, intent),
    ...[...plain, ...aesthetic.slice(0, AESTHETIC_EXTRA)].map((p) => p.url),
  ].filter((u) => u && !rejected.has(u));
  if (urls.length === 0) return null;

  const downloaded = await downloadAll([...new Set(urls)]);
  const cands: Cand[] = [...new Set(urls)]
    .filter((u) => downloaded.has(u))
    .map((u) => ({ url: u, buf: downloaded.get(u) as Buffer, origin: "pexels" as const }));
  if (cands.length === 0) return null;

  const [pick] = await judge([{ intent }], [cands], opts.topic ?? "");
  // -1 means "nothing here depicts it"; the user asked for a different photo, so
  // offer the closest ones rather than refusing outright.
  const top = pick >= 0 && pick < cands.length ? pick : 0;
  const ranked = [cands[top], ...cands.filter((_, i) => i !== top)].map((c) => ({
    url: c.url,
    raw: c.buf as Buffer,
  }));
  return { ranked, judged: pick >= 0 };
}
