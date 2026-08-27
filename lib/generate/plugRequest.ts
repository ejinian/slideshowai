// Does the user's prompt ASK us to plug something?
//
// WHY THIS EXISTS: the copy prompts carry a hard "NO AD SLIDE. Never insert a
// promo/product slide" rule, added 2026-07-19 because the structure used to
// force exactly one `plug` slide and — with nothing to sell — the model filled
// it by parroting the prompt onto a random photo. That fix overcorrected: a user
// who writes "plug my website shredguide.ai" got a deck that never mentioned
// shredguide.ai at all, because the system prompt outranked their request.
//
// So the ban becomes CONDITIONAL. Detection is local, deterministic and free
// (no model call): if the prompt asks for a plug, the prompt flips from "never
// promote" to "promote exactly this, on exactly one slide, by name" — and
// `mentionsTarget` lets the caller verify the name actually made it in.

export interface PlugRequest {
  /** The user asked for a plug. */
  requested: boolean;
  /** What to plug, verbatim (a domain if we found one). null = they asked but
   *  didn't give us a clean handle; the model reads it off the prompt itself. */
  target: string | null;
}

// A bare domain is the highest-confidence signal there is — nobody types
// "shredguide.ai" into a slideshow prompt by accident. Deliberately does NOT
// match sentence-ending words ("consistent. in one of…") because the TLD list
// is explicit rather than \w+.
const DOMAIN_RE =
  /\b((?:https?:\/\/)?(?:www\.)?[a-z0-9][a-z0-9-]{0,61}\.(?:ai|com|io|co|app|net|org|dev|xyz|shop|store|gg|me|us|uk|ca|so|to|fit))\b(\/[^\s,]*)?/i;

// Intent words, for when they ask for a plug without giving a URL
// ("promote my coaching program", "mention my bakery on one slide").
const INTENT_RE =
  /\b(plug|promote|advertis(?:e|ing)|shout ?out|mention (?:my|our)|feature (?:my|our)|link in bio|sell (?:my|our)|my (?:website|site|app|brand|business|product|store|shop|program|service)|our (?:website|site|app|brand|business|product|store|shop|program|service))\b/i;

// A capitalised name declared as the user's own thing ("Newman's Coffee is my
// brand", "my brand is called Newman's Coffee") — the second-best handle after
// a domain. Without it, target stays null and none of the mechanical checks
// (mentionsTarget, the hook ban below) can run; run 63 shipped a branded hook
// for exactly that reason.
const OWNED_NOUNS =
  "brand|business|company|product|store|shop|app|website|site|service|program|bakery|cafe|gym|studio";
const NAME_DECL_RE = new RegExp(
  `([A-Z][\\w'’&.-]*(?:\\s+[A-Z][\\w'’&.-]*){0,3})\\s+is\\s+(?:my|our)\\s+(?:${OWNED_NOUNS})\\b`,
);
const DECL_NAME_RE = new RegExp(
  `\\b(?:my|our)\\s+(?:${OWNED_NOUNS})(?:\\s+is)?(?:\\s+called)?[,:]?\\s+["“]?([A-Z][\\w'’&.-]*(?:\\s+[A-Z][\\w'’&.-]*){0,3})["”]?`,
);

/**
 * Inspect the composer prompt for a plug request. Pure, no I/O — safe to call
 * on every generation.
 */
export function detectPlug(prompt: string | undefined | null): PlugRequest {
  const text = (prompt ?? "").trim();
  if (!text) return { requested: false, target: null };

  const domain = text.match(DOMAIN_RE);
  const intent = INTENT_RE.test(text);

  // A domain alone is enough: if someone names their site in the prompt, they
  // want it on the deck. Intent alone counts too, we just have no clean handle.
  if (!domain && !intent) return { requested: false, target: null };

  const named = text.match(NAME_DECL_RE) ?? text.match(DECL_NAME_RE);
  return {
    requested: true,
    // Normalise to the bare domain — "https://www.myapp.io/pricing" belongs in a
    // browser, "myapp.io" belongs on a slide. This string is what must appear on
    // the slide and what mentionsTarget checks for.
    target: domain
      ? domain[1].replace(/^https?:\/\//i, "").replace(/^www\./i, "").replace(/\/$/, "")
      : (named?.[1].trim() ?? null),
  };
}

// Words too generic to identify a brand on their own — "Newman's Coffee" is
// named by "newman's", never by "coffee" (a coffee deck's hook says "coffee"
// legitimately).
const GENERIC_TOKENS = new Set([
  "the", "a", "an", "my", "our", "and", "of", "co", "inc", "llc",
]);

/**
 * Does this text name the brand? Looser than mentionsTarget: a hook saying
 * "switched to newman's" names "Newman's Coffee" even though the full string
 * is absent. Matches the whole target OR its first distinctive token, so
 * generic trailing words ("Coffee", "Gym") can't false-positive.
 */
export function namesBrand(text: string, target: string | null): boolean {
  if (!target) return false;
  const t = fold(text);
  const full = fold(target).replace(/^(https?:\/\/)?(www\.)?/, "");
  if (t.includes(full)) return true;
  const first = full
    .split(/[\s.]+/)
    .find((w) => w.length >= 3 && !GENERIC_TOKENS.has(w));
  return !!first && t.includes(first);
}

/**
 * Did the finished deck actually name the thing? Compares loosely — the model
 * may capitalise it or wrap it in punctuation, but the domain body has to be
 * there. Returns true when there's nothing specific to check for.
 */
export function mentionsTarget(
  deck: { text?: string | null; body?: string | null }[],
  target: string | null,
): boolean {
  if (!target) return true;
  const needle = fold(target).replace(/^(https?:\/\/)?(www\.)?/, "");
  return deck.some((s) => fold(`${s.text ?? ""} ${s.body ?? ""}`).includes(needle));
}

/** Lowercase + straighten typographic apostrophes, so a user's "Newman’s" and
 *  the model's "newman's" compare equal. */
function fold(s: string): string {
  return s.toLowerCase().replace(/[’‘]/g, "'");
}

/**
 * The prompt section that REPLACES the standing "no ad slide" rule when a plug
 * was requested. Kept deliberately narrow: ONE slide, named verbatim, and the
 * rest of the deck stays pure value — that's what stops the 2026-07-19 failure
 * (a mandatory slot filled with prompt-parroting junk) from coming back.
 */
export function plugBlock(plug: PlugRequest): string {
  if (!plug.requested) return "";
  const named = plug.target
    ? `"${plug.target}"`
    : "the product/business the user named in their topic";
  return (
    "THE USER ASKED YOU TO PLUG SOMETHING — this overrides the usual no-ad-slide " +
    `rule. Exactly ONE middle slide must promote ${named}.\n` +
    (plug.target
      ? `• Write ${named} EXACTLY as spelled here, on that slide. Not a paraphrase, ` +
        "not 'my website', not a description of it — the literal name. If it is " +
        "missing from the deck, the deck is wrong.\n"
      : "• Name it explicitly on that slide, exactly as the user wrote it.\n") +
    "• That slide still has to earn its place: tie the plug to a real reason " +
    "someone would use it, in the same voice as the rest of the deck. A slide " +
    "that just says the name is a wasted slide.\n" +
    "• EVERY OTHER middle slide stays pure value with no mention of it. One plug, " +
    "not a sales deck.\n" +
    "• THE HOOK NEVER NAMES IT — this is the difference between a story and an " +
    "ad. Even when the user's whole topic is the product, slide 1 opens on the " +
    "pain, curiosity or payoff a stranger relates to ('i stopped feeling wired " +
    "after my afternoon coffee'), with zero brand words. The name lands mid-deck " +
    "as the natural reveal — the answer the story was building to — never as " +
    "the opener, and never on the CTA. A branded hook reads as an ad on sight " +
    "and kills reach."
  );
}
