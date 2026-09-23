import type OpenAI from "openai";
import type { SupabaseClient } from "@supabase/supabase-js";
import { tryCopyModel } from "./copyModel";
import { poolThumb } from "./collectionPool";

// What is IN each photo of a collection pick, and whether it already carries
// text — read once per photo by vision and cached on collection_images
// (vision_note, has_text; migration 20260922130000), so a 60-photo collection
// is described once, not on every run.
//
// Why (Christian, 2026-09-22, run 94): captions were written blind to the
// pool, and the matcher then had to place "hiring my first team member" over
// whatever the collection had — a man beside a mountain of cash. The notes now
// go to the copy step, so the deck is written to what the photos can carry,
// and to the matcher as text beside each thumbnail. has_text drops photos
// with baked-in text (screen text, quotes, memes, screenshots) from the pool:
// a slide caption on top of a photo that already has its own text reads as a
// mistake, and a prompt-only "avoid text" rule was already proven to leak on
// the Pinterest pool — exclusion has to be mechanical.
//
// Fails open everywhere: no key, missing columns, a failed or misaligned call
// → no notes, nothing excluded, the run proceeds exactly as before.

export interface PoolNotes {
  /** One line per pool photo (same index as the pool), null when unknown. */
  notes: (string | null)[];
  /** Photo carries readable text of its own — keep it out of the pool. */
  hasText: boolean[];
  cached: number;
  described: number;
  model: string | null;
  /** Why a chunk came back empty — surfaced in diagnostics, never thrown. */
  errors: string[];
}

// Photos per vision call. One 60-photo call worked locally and came back
// EMPTY on production (2026-09-22, first prod run after ship): a single
// misaligned or oversized answer voided the whole pool. Small parallel chunks
// keep each answer short enough to align reliably, and a bad chunk costs
// only its own photos.
const CHUNK = 12;

const DESCRIBE_SYSTEM =
  "You catalogue a creator's photo collection for a TikTok slideshow tool. " +
  "For EVERY photo, in order, return:\n" +
  "• note: what is literally in it, in at most 12 plain words — subject, " +
  "setting, action (\"man in a suit beside a pile of cash in an office\", " +
  "\"espresso pouring into a cup at a cafe counter\"). No adjectives about " +
  "quality or mood, no guesses about who the person is.\n" +
  "• text: true if the photo already has READABLE TEXT baked into it that a " +
  "caption laid over the photo would collide with — on-screen text, captions " +
  "or subtitles, quotes, memes, signs or posters filling a meaningful part of " +
  "the frame, screenshots of messages or documents. Small incidental text (a " +
  "license plate, a brand mark on a product, a distant street sign) is false.\n" +
  "One entry per photo, same order, no photo skipped.";

const DESCRIBE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["photos"],
  properties: {
    photos: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["note", "text"],
        properties: {
          note: { type: "string" },
          text: { type: "boolean" },
        },
      },
    },
  },
} as const;

const NOTE_MAX = 120;

interface CachedRow {
  id: string;
  vision_note?: string | null;
  has_text?: boolean | null;
}

export async function describePool(
  images: Buffer[],
  /** collection_images ids, index-aligned with `images` (may be empty). */
  ids: string[],
  supabase: SupabaseClient,
): Promise<PoolNotes> {
  const n = images.length;
  const notes: (string | null)[] = new Array<string | null>(n).fill(null);
  const hasText: boolean[] = new Array<boolean>(n).fill(false);
  if (n === 0) return { notes, hasText, cached: 0, described: 0, model: null, errors: [] };

  // 1) Cache. Only when ids line up with the pool; otherwise (or before the
  //    migration has run) nothing is cached and everything is described.
  const known = new Set<number>();
  let canCache = ids.length === n;
  if (canCache) {
    const { data, error } = await supabase
      .from("collection_images")
      .select("id, vision_note, has_text")
      .in("id", ids);
    if (error) {
      canCache = false;
    } else {
      const byId = new Map((data ?? []).map((r) => [(r as CachedRow).id, r as CachedRow]));
      ids.forEach((id, i) => {
        const r = byId.get(id);
        if (r && typeof r.vision_note === "string" && r.vision_note) {
          notes[i] = r.vision_note;
          hasText[i] = r.has_text === true;
          known.add(i);
        }
      });
    }
  }
  const todo = images.map((_b, i) => i).filter((i) => !known.has(i));
  if (todo.length === 0) {
    return { notes, hasText, cached: known.size, described: 0, model: "cache", errors: [] };
  }

  // 2) Vision, in parallel chunks, for whatever isn't cached.
  const cm = tryCopyModel({ timeoutMs: 90_000 });
  if (!cm) return { notes, hasText, cached: known.size, described: 0, model: null, errors: ["no copy model"] };
  const chunks: number[][] = [];
  for (let i = 0; i < todo.length; i += CHUNK) chunks.push(todo.slice(i, i + CHUNK));
  const errors: string[] = [];
  let described = 0;
  await Promise.all(
    chunks.map(async (chunk, ci) => {
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const got = await describeChunk(cm.client as OpenAI, cm.model, chunk.map((i) => images[i]));
          chunk.forEach((i, k) => {
            const note = (got[k]?.note ?? "").replace(/\s+/g, " ").trim().slice(0, NOTE_MAX);
            notes[i] = note || null;
            hasText[i] = got[k]?.text === true;
          });
          described += chunk.length;
          return;
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          if (attempt === 1) errors.push(`chunk ${ci} (photos ${chunk[0]}-${chunk[chunk.length - 1]}): ${msg}`);
        }
      }
    }),
  );
  if (errors.length > 0) {
    console.warn("[collection] describe: some chunks failed — those photos have no notes and are not excluded", {
      pool: n,
      described,
      errors,
    });
  }

  // 3) Cache, best-effort. The session client can write: collection_images is
  //    owner-writable under RLS. Before the migration the update just fails.
  if (canCache && described > 0) {
    await Promise.all(
      todo.map((i) =>
        notes[i]
          ? supabase
              .from("collection_images")
              .update({ vision_note: notes[i], has_text: hasText[i] })
              .eq("id", ids[i])
              .then(
                () => {},
                () => {},
              )
          : Promise.resolve(),
      ),
    );
  }
  return {
    notes,
    hasText,
    cached: known.size,
    described,
    model: described > 0 ? cm.label : null,
    errors,
  };
}

/** One vision call over one chunk. Throws on any failure, including an answer
 *  whose length doesn't match — a short or long list would misalign every
 *  photo after the gap, so it is only trusted when the count is exact. */
async function describeChunk(
  client: OpenAI,
  model: string,
  images: Buffer[],
): Promise<{ note?: string; text?: boolean }[]> {
  const thumbs = await Promise.all(images.map(poolThumb));
  const content: Array<
    | { type: "text"; text: string }
    | { type: "image_url"; image_url: { url: string; detail: "low" } }
  > = [
    {
      type: "text",
      text: `${images.length} photos follow, numbered 0..${images.length - 1}. Return exactly ${images.length} entries, one per photo, in that order.`,
    },
  ];
  thumbs.forEach((t, k) => {
    content.push({ type: "text", text: `photo ${k}:` });
    if (t) content.push({ type: "image_url", image_url: { url: t, detail: "low" } });
    else content.push({ type: "text", text: "(unreadable)" });
  });
  const completion = await client.chat.completions.create({
    model,
    temperature: 0,
    messages: [
      { role: "system", content: DESCRIBE_SYSTEM },
      { role: "user", content },
    ],
    response_format: {
      type: "json_schema",
      json_schema: { name: "pool_notes", strict: true, schema: DESCRIBE_SCHEMA },
    },
  });
  const parsed = JSON.parse(completion.choices[0]?.message?.content ?? "{}") as {
    photos?: { note?: string; text?: boolean }[];
  };
  const got = parsed.photos ?? [];
  if (got.length !== images.length) {
    throw new Error(`described ${got.length} of ${images.length} photos`);
  }
  return got;
}
