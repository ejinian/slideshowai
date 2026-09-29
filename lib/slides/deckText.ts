import { replaceStatedCount, statedListCount } from "@/lib/generate/listCount";

// Pure (no server deps) — the slide editor runs it in the browser.
//
// Keeps a deck TRUE across a structural edit (a slide deleted, moved or put
// back). Two things go stale the moment the slide count or order changes:
//
//   • a numbered list — delete "2." and the deck reads "1. 3. 4."
//   • the hook's stated count — "5 mistakes" over four slides
//
// Both are repaired ONCE, at the moment of the edit, and the result lands in
// the caption box like any other edit — so the user can see it and overrule
// it. That is what separates this from render-time rewriting, which the
// caption rules forbid because it is invisible in the box and unwinnable.
//
// It only ever MAINTAINS an invariant the deck already had. A list that was not
// numbered 1..n in order (a countdown, a partial list, numbers the user chose)
// is left exactly as it is, and so is a hook whose count did not match.

export interface DeckTextSlide {
  role: string | null;
  number: number | null;
  caption: string;
}

/** "1. " / "2) " opening a caption — the inline list number. */
const PREFIX = /^(\s*)(\d{1,2})(\s*[.)]\s)/;

const isListSlide = (s: DeckTextSlide) => s.role === "reason" || s.role === "plug";

/** The number a slide SHOWS: typed into the caption, or the stored `number`
 *  that layoutSlide prefixes at render time on decks made before numbers were
 *  baked into the text. */
function shownNumber(s: DeckTextSlide): number | null {
  const m = PREFIX.exec(s.caption);
  if (m) return parseInt(m[2], 10);
  return s.number != null && isListSlide(s) ? s.number : null;
}

/**
 * `before` and `after` are the deck either side of the edit, in slide order.
 * Returns `after` with numbering and hook count brought back in line; slides
 * that need no change are returned as the same object.
 */
export function reconcileDeckText<T extends DeckTextSlide>(before: T[], after: T[]): T[] {
  let out = after;

  // One numbered slide still counts: it is what is left of a list after a
  // delete, and putting the deleted slide back has to renumber around it.
  const list = before.filter(isListSlide);
  const wasNumbered =
    list.length >= 1 && list.every((s, i) => shownNumber(s) === i + 1);
  if (wasNumbered) {
    let n = 0;
    out = out.map((s) => {
      // An unnumbered slide sitting in the list is skipped, not counted, so the
      // numbered ones stay consecutive around it.
      if (!isListSlide(s) || shownNumber(s) == null) return s;
      n += 1;
      const caption = PREFIX.test(s.caption)
        ? s.caption.replace(PREFIX, `$1${n}$3`)
        : s.caption;
      const number = s.number != null ? n : null;
      return caption === s.caption && number === s.number
        ? s
        : { ...s, caption, number };
    });
  }

  // The count is the slides AFTER the hook — the same rule generation enforces.
  const hookBefore = before.find((s) => s.role === "title");
  const claimed = hookBefore ? statedListCount(hookBefore.caption) : null;
  const now = after.length - 1;
  if (claimed != null && claimed === before.length - 1 && now !== claimed && now >= 2) {
    out = out.map((s) =>
      s.role === "title" && statedListCount(s.caption) === claimed
        ? { ...s, caption: replaceStatedCount(s.caption, now) }
        : s,
    );
  }

  return out;
}
