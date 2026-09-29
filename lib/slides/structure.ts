import type { SupabaseClient } from "@supabase/supabase-js";

// Server helpers shared by the routes that change a deck's SHAPE — reorder,
// delete-slide, restore-slide. All three are pure DB writes: a slide's
// background is bound to the slide row (`storage_path` is an identifier, not an
// ordinal), so nothing in Storage moves and nothing is re-baked.

const MAX_CAPTION_CHARS = 300;

export interface SlideText {
  caption: string;
  number: number | null;
}

/**
 * Caption/number rewrites that ride along with a structural edit — the editor
 * renumbers a list and corrects the hook's count in the same gesture (see
 * lib/slides/deckText.ts). Keyed by the slide's position AFTER the edit.
 * Anything malformed is dropped rather than failing the edit.
 */
export function parseTexts(raw: unknown, slideCount: number): Map<number, SlideText> {
  const out = new Map<number, SlideText>();
  if (!Array.isArray(raw)) return out;
  for (const t of raw as Record<string, unknown>[]) {
    if (!t || typeof t !== "object") continue;
    const position = t.position;
    if (typeof position !== "number" || !Number.isInteger(position)) continue;
    if (position < 0 || position >= slideCount) continue;
    if (typeof t.caption !== "string") continue;
    const caption = t.caption.trim().slice(0, MAX_CAPTION_CHARS);
    // Same rule as a caption edit: a slide is never committed textless.
    if (!caption) continue;
    const number =
      typeof t.number === "number" && Number.isInteger(t.number) && t.number >= 1 && t.number <= 99
        ? t.number
        : null;
    out.set(position, { caption, number });
  }
  return out;
}

/**
 * Bump the parent so hub thumbnails (versioned by updated_at) refetch, and keep
 * the stored slide count honest when the deck grew or shrank.
 */
export async function touchDeck(
  supabase: SupabaseClient,
  id: string,
  slideCount?: number,
): Promise<void> {
  await supabase
    .from("slideshows")
    .update({
      updated_at: new Date().toISOString(),
      ...(slideCount != null ? { slide_count: slideCount } : {}),
    })
    .eq("id", id);
}

/** A background path is only ever valid inside the caller's own deck folder. */
export function ownsPath(path: unknown, userId: string, slideshowId: string): path is string {
  return (
    typeof path === "string" &&
    path.startsWith(`${userId}/${slideshowId}/`) &&
    !path.includes("..")
  );
}
