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

  return {
    requested: true,
    // Normalise to the bare domain — "https://www.myapp.io/pricing" belongs in a
    // browser, "myapp.io" belongs on a slide. This string is what must appear on
    // the slide and what mentionsTarget checks for.
    target: domain
      ? domain[1].replace(/^https?:\/\//i, "").replace(/^www\./i, "").replace(/\/$/, "")
      : null,
  };
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
  const needle = target.toLowerCase().replace(/^(https?:\/\/)?(www\.)?/, "");
  return deck.some((s) =>
    `${s.text ?? ""} ${s.body ?? ""}`.toLowerCase().includes(needle),
  );
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
    "• Do not put the plug on the hook slide or the CTA."
  );
}
