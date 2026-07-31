// Is this prompt specific enough to build a deck worth posting?
//
// The failure this exists to catch is the one CLAUDE.md's value section names:
// decks that are true, useless and forgettable. "cool cars" can only produce
// "vintage style meets modern design" — nobody can DO anything with that. A
// prompt carrying a number, an instruction, or a hook shape ("the truth about
// …", "5 mistakes …") gives the model something concrete to deliver.
//
// Deliberately deterministic and dependency-free: this runs on every keystroke
// pause in the composer, so deciding whether a prompt is weak must cost nothing.
// Only when the user asks for pivots do we spend a model call (/api/sharpen).

const STOPWORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "but", "by", "for", "from", "in",
  "into", "is", "it", "its", "my", "of", "on", "or", "our", "that", "the",
  "their", "these", "this", "to", "up", "was", "we", "with", "you", "your",
]);

// Words that signal the prompt already has an ANGLE, not just a subject: a
// question, an instruction, a comparison, or a proven hook shape.
const ANGLE_CUES = new Set([
  "how", "why", "what", "when", "where", "which", "who",
  "truth", "secret", "secrets", "nobody", "everyone", "actually", "really",
  "mistake", "mistakes", "wrong", "stop", "avoid", "start", "fix", "fixed",
  "best", "worst", "signs", "reason", "reasons", "way", "ways", "step",
  "steps", "tip", "tips", "rule", "rules", "guide", "myth", "myths",
  "before", "after", "vs", "versus", "instead", "without", "until",
  "build", "make", "get", "grow", "lose", "save", "learn", "try", "use",
  "need", "should", "must", "never", "always", "cost", "costs", "price",
  "review", "compare", "ranked", "tier", "routine", "checklist",
]);

const NUMBER_WORDS = new Set([
  "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten",
]);

function contentWords(prompt: string): string[] {
  return (prompt.toLowerCase().match(/[a-z0-9][a-z0-9'-]*/g) ?? []).filter(
    (w) => !STOPWORDS.has(w),
  );
}

export interface PromptStrength {
  /** True when the prompt is a bare subject with no angle to deliver on. */
  weak: boolean;
  score: number;
  /** Short, plain reason — shown to the user, so no jargon. */
  reason: string;
}

/**
 * Score a composer prompt. `weak` is the only field the UI branches on; the
 * score and reason exist so the nudge can say something specific and so this is
 * easy to reason about in tests.
 */
export function assessPrompt(raw: string): PromptStrength {
  const prompt = (raw || "").trim();
  // Nothing typed yet isn't "weak" — that's what the Try pill is for.
  if (prompt.length === 0) return { weak: false, score: 0, reason: "" };

  const words = contentWords(prompt);
  const hasNumber = words.some((w) => /\d/.test(w) || NUMBER_WORDS.has(w));
  const hasAngle = words.some((w) => ANGLE_CUES.has(w));

  let score = 0;
  if (hasNumber) score += 2;
  if (hasAngle) score += 2;
  if (words.length >= 5) score += 1;
  if (words.length >= 8) score += 1;

  const weak = score < 2;
  const reason = !weak
    ? ""
    : words.length <= 2
      ? "That's a subject, not an angle yet."
      : "No number, promise or hook to deliver on yet.";

  return { weak, score, reason };
}
