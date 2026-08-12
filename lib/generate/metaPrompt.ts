// Is the composer prompt an INSTRUCTION ABOUT the deck rather than a TOPIC for it?
//
// WHY THIS EXISTS: the copy prompt injects the box verbatim as
//   "TOPIC — what this WHOLE slideshow must be about: <prompt>
//    That topic is the entire subject."
// Someone with a reference attached naturally types "make one just like the
// reference" — the composer required *something* in the box — and that phrase
// then became the declared subject. It is not a subject, so the model
// free-associated one: two runs of the same URL produced a gym-plateau deck and
// a deck about sleep (diagnostics Run_1 / Run_2, 2026-08-10).
//
// Deterministic and local — this runs on every generation, so it must never
// cost a model call. Deliberately NARROW: it only matches phrases that are
// entirely self-referential. Anything carrying real subject matter ("make one
// like this about cold plunges") is left alone, because that IS a topic.

/** Verbs people use when asking for a copy of something already attached. */
const COPY_VERB =
  "(?:make|create|build|generate|do|write|give me|copy|recreate|replicate|mimic|remake)";
/** What they point at: the reference, this post, that deck, the example… */
const TARGET =
  "(?:(?:the|this|that|these|those|my|your)\\s+)?(?:reference|link|url|tiktok|post|example|slideshow|deck|video|one|thing)|this|that|it";

// EVERY pattern is anchored to the END of the string. That is the whole trick:
// "make one like this" is a pointer, but "make one about sleep" and "make a
// slideshow about our coffee shop" carry a real subject after the noun — and an
// unanchored pattern swallowed both as meta, discarding the user's actual topic.
const META_PATTERNS: RegExp[] = [
  // "make one just like the reference", "recreate this post", "copy that deck"
  new RegExp(
    `^${COPY_VERB}\\s+(?:me\\s+)?(?:a|an|one|something)?\\s*(?:just\\s+)?(?:like|similar to|based on|off of|from)?\\s*(?:${TARGET})\\s*$`,
    "i",
  ),
  // "same as the reference", "same thing as this"
  new RegExp(`^same\\s+(?:thing\\s+)?(?:as|like)\\s+(?:${TARGET})\\s*$`, "i"),
  // "like the reference", "just like this"
  new RegExp(`^(?:just\\s+)?like\\s+(?:${TARGET})\\s*$`, "i"),
  // bare pointers: "the reference", "this one", "that tiktok"
  new RegExp(`^(?:${TARGET})\\s*$`, "i"),
];

/**
 * True when the prompt says nothing about SUBJECT MATTER — it only points back
 * at something the user already attached. Callers should treat such a prompt as
 * no topic at all rather than as the deck's subject.
 *
 * Requires the text to be SHORT: a long prompt that happens to start with
 * "make one like this" almost certainly goes on to say what it's about, and
 * that continuation is a real topic we must not discard.
 */
export function isMetaPrompt(prompt: string | undefined | null): boolean {
  const text = (prompt ?? "").trim().replace(/[.!?]+$/, "");
  if (!text) return false;
  // ~8 words is enough for every pointer phrasing above and short enough that a
  // real topic can't hide inside it.
  if (text.split(/\s+/).length > 8) return false;
  return META_PATTERNS.some((re) => re.test(text));
}
