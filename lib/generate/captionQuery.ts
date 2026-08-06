// Turn a finished caption back into a stock-photo search.
//
// Only needed for decks generated before `slides.image_keywords` existed
// (migration 20260806120000). Newer slides carry the copy model's own subject
// phrases and should always use those instead — this is the fallback.
//
// WHY IT EXISTS: the editor's "Try another photo" first passed raw caption
// words as keywords, and `slideQuery` takes the first two of them. On a
// listicle those two words are the list number and a filler word, so Pexels was
// being asked for "4 reasons", "1. Instant", "2. These" — and every replacement
// photo was unrelated to the deck. The subject is in the caption; it just isn't
// at the front.

// Function words, list scaffolding and the vague filler that survives it. None
// of these describe anything a photo could show.
const STOPWORDS = new Set([
  "a", "an", "the", "and", "or", "but", "if", "so", "then", "than", "that",
  "this", "these", "those", "there", "here", "it", "its", "is", "are", "was",
  "were", "be", "been", "being", "am", "do", "does", "did", "done", "have",
  "has", "had", "will", "would", "can", "could", "should", "may", "might",
  "must", "of", "in", "on", "at", "to", "for", "with", "without", "from",
  "by", "as", "into", "onto", "about", "over", "under", "up", "down", "out",
  "off", "not", "no", "you", "your", "yours", "my", "me", "mine", "we", "our",
  "us", "they", "them", "their", "he", "she", "his", "her", "him", "who",
  "what", "when", "where", "why", "how", "which", "all", "any", "each",
  "every", "more", "most", "some", "such", "only", "just", "even", "also",
  "very", "too", "really", "still", "get", "gets", "got", "make", "makes",
  "made", "one", "ones", "thing", "things", "way", "ways", "reason", "reasons",
  "tip", "tips", "step", "steps", "know", "knows", "need", "needs", "want",
  "wants", "like", "best", "better", "good", "great", "top", "new", "actually",
  "never", "always", "ever", "before", "after", "while", "because", "own",
  // Generic verbs and pronouns that lead a sentence but depict nothing. Without
  // these, "5 things nobody tells you about the bench press" searched for
  // "nobody tells" instead of "bench press" — the subject is rarely first, and
  // only the first two surviving terms become the query.
  "enjoy", "enjoys", "tell", "tells", "telling", "nobody", "somebody", "anyone",
  "everyone", "someone", "feel", "feels", "feeling", "keep", "keeps", "keeping",
  "help", "helps", "helping", "work", "works", "working", "give", "gives",
  "take", "takes", "taking", "put", "puts", "use", "uses", "using", "try",
  "tries", "trying", "going", "coming", "add", "adds", "adding", "start",
  "starts", "stop", "stops", "look", "looks", "looking", "think", "thinks",
  "see", "sees", "say", "says", "come", "comes", "go", "goes", "let", "lets",
]);

/**
 * Best-effort search terms from a caption, most meaningful first.
 *
 * Returns an array shaped like the model's own `image_keywords` so it can be
 * dropped straight into a LiveIntent — the caller does not need to know whether
 * the terms were stored or derived.
 */
export function captionKeywords(caption: string, max = 4): string[] {
  const cleaned = (caption || "")
    // Leading list scaffolding: "1.", "2)", "3 -", "Step 4:".
    .replace(/^\s*(?:step\s*)?\d+\s*[.)\-:]*\s*/i, "")
    .toLowerCase()
    // Keep intra-word hyphens/apostrophes ("stress-free", "don't"); drop the rest.
    .replace(/[^a-z0-9'\-\s]/g, " ");

  const words = cleaned.split(/\s+/).filter(Boolean);
  const kept: string[] = [];
  const seen = new Set<string>();
  for (const w of words) {
    // Bare numbers describe nothing on their own ("4", "600"); a number bound to
    // a unit ("3x", "15mg") is a real subject and stays.
    if (/^\d+$/.test(w)) continue;
    if (w.length < 3 || STOPWORDS.has(w)) continue;
    if (seen.has(w)) continue;
    seen.add(w);
    kept.push(w);
    if (kept.length >= max) break;
  }
  return kept;
}
