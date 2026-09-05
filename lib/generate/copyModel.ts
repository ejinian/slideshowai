// Which LLM writes the captions. ONE seam, so an A/B is a deploy env var and
// not a diff across the hard-won copy prompts.
//
// xAI's API is OpenAI-wire-compatible — same `openai` package, same
// `chat.completions.create`, same structured-output shape — so switching
// providers is a baseURL and a model string. The prompts in listicle.ts /
// imageFirst.ts are untouched by this file, which is the whole point: the thing
// we are testing is the MODEL's voice, so everything else has to stay identical
// or the comparison means nothing.
//
// WHY GROK IS WORTH TESTING (and what it is not): nothing in this pipeline was
// ever refused, so "less censored" is not the lever. The lever is that gpt-4o is
// heavily flattened toward assistant register, and these captions live or die on
// sounding like a person typed them (docs/anti-ai-voice.md). Expect a modest
// effect, and measure it against the real on-slide hooks now landing in
// `trending_posts.slide_texts` rather than against taste.

import OpenAI from "openai";

export type CopyProvider = "openai" | "xai";

const XAI_BASE_URL = "https://api.x.ai/v1";

export interface CopyModel {
  client: OpenAI;
  /** Model id to pass as `model:`. */
  model: string;
  provider: CopyProvider;
  /** "gpt-4o (openai)" — for diagnostics headers and error messages. */
  label: string;
}

/** `GEN_PROVIDER=xai` (or `grok`) switches the copy model. Default is openai. */
export function resolveProvider(): CopyProvider {
  const v = (process.env.GEN_PROVIDER ?? "").trim().toLowerCase();
  return v === "xai" || v === "grok" ? "xai" : "openai";
}

interface ProviderConfig {
  apiKey: string | undefined;
  baseURL?: string;
  model: string;
  /** Env var to name in the "not configured" error. */
  keyVar: string;
}

function config(provider: CopyProvider): ProviderConfig {
  if (provider === "xai") {
    return {
      apiKey: process.env.XAI_API_KEY,
      baseURL: XAI_BASE_URL,
      // Overridable because xAI ships model ids faster than this file changes;
      // `GET https://api.x.ai/v1/models` lists what the key can actually reach.
      model: process.env.XAI_MODEL || "grok-4",
      keyVar: "XAI_API_KEY",
    };
  }
  return {
    apiKey: process.env.OPENAI_API_KEY,
    model: process.env.OPENAI_COPY_MODEL || "gpt-4o",
    keyVar: "OPENAI_API_KEY",
  };
}

const configured = (c: ProviderConfig) =>
  Boolean(c.apiKey) && !c.apiKey!.includes("REPLACE_ME");

/**
 * The configured copy model, or null when its key is missing.
 * Callers that can degrade gracefully (imageFirst's vision pass falls back to
 * copy-first) use this; callers that must fail loudly use `copyModel`.
 */
export function tryCopyModel(opts: { timeoutMs: number }): CopyModel | null {
  const provider = resolveProvider();
  const c = config(provider);
  if (!configured(c)) return null;
  return {
    client: new OpenAI({
      apiKey: c.apiKey!,
      baseURL: c.baseURL,
      timeout: opts.timeoutMs,
      maxRetries: 0,
    }),
    model: c.model,
    provider,
    label: `${c.model} (${provider})`,
  };
}

/**
 * As `tryCopyModel`, but throws an actionable error instead of returning null.
 *
 * It does NOT fall back to the other provider. A silent fallback would mean
 * setting GEN_PROVIDER=xai with no key produces a normal-looking gpt-4o run and
 * an A/B that quietly measured nothing — the same failure as PEXELS_API_KEY
 * being local-only while stock silently served the frozen library.
 */
export function copyModel(opts: { timeoutMs: number }): CopyModel {
  const cm = tryCopyModel(opts);
  if (cm) return cm;
  const provider = resolveProvider();
  const { keyVar } = config(provider);
  throw new Error(
    `${keyVar} is not set, but the copy model is ${provider}. ` +
      (provider === "xai"
        ? "Add it to .env.local (get one at console.x.ai) and restart the dev server, or unset GEN_PROVIDER to go back to OpenAI."
        : "Add it to .env.local and restart the dev server."),
  );
}

/**
 * Turns an SDK error into something a human can act on. The SDK is OpenAI's for
 * both providers, so `OpenAI.APIError` is thrown either way — only the console
 * to send someone to differs.
 */
export function describeApiError(
  err: InstanceType<typeof OpenAI.APIError>,
  cm: CopyModel,
): Error {
  const console_ =
    cm.provider === "xai"
      ? "console.x.ai → Billing"
      : "platform.openai.com → Billing";
  // A 429 is TWO unrelated failures wearing one status code, and they have
  // opposite fixes. `insufficient_quota` means the account is out of money.
  // Everything else 429 is a rate limit — requests or tokens per minute — which
  // a paid-up account hits routinely, because one deck fans out into several
  // gpt-4o calls (copy, then a vision judge per slide) and compare mode doubles
  // it. Reporting that as "add credits" sends someone to a Billing page that is
  // already fine, which is where an hour goes.
  // ⚠️ Check BOTH `code` and `type`. An exhausted balance now comes back as
  // `{type:"insufficient_quota", code:"credit_balance_exhausted"}` — the
  // specific value moved to `code`, so a `code`-only test missed it and the
  // 429 branch below told us "not a billing problem" while the API's own
  // message said "You have no credits remaining" (hit 2026-09-05 on the local
  // key, which cost a round of debugging the wrong thing).
  if (
    err.code === "insufficient_quota" ||
    err.code === "credit_balance_exhausted" ||
    (err as { type?: string }).type === "insufficient_quota"
  ) {
    return new Error(
      `${cm.label} is out of credit. Add credits at ${console_}. Each slideshow costs roughly a cent or two.`,
    );
  }
  if (err.status === 429) {
    return new Error(
      `${cm.label} rate limit (429) — too many requests or tokens per minute, not a billing problem. ` +
        `Wait a minute and try again. If it repeats, the key's project has its own rate/budget limit: ` +
        `check platform.openai.com → Settings → your project → Limits.`,
    );
  }
  if (err.status === 401) {
    return new Error(
      `${cm.label} rejected the API key (401). Double-check ${
        cm.provider === "xai" ? "XAI_API_KEY" : "OPENAI_API_KEY"
      } in .env.local.`,
    );
  }
  if (err.status === 404) {
    return new Error(
      `${cm.label} was not found (404) — the model id is probably wrong for this key. ` +
        `List what the key can reach with: curl ${
          cm.provider === "xai" ? XAI_BASE_URL : "https://api.openai.com/v1"
        }/models -H "Authorization: Bearer $${
          cm.provider === "xai" ? "XAI_API_KEY" : "OPENAI_API_KEY"
        }", then set ${cm.provider === "xai" ? "XAI_MODEL" : "OPENAI_COPY_MODEL"}.`,
    );
  }
  return new Error(`${cm.label} request failed (${err.status}): ${err.message}`);
}
