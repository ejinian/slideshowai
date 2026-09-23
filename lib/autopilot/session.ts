import { createClient as createSupabaseClient, type SupabaseClient } from "@supabase/supabase-js";

// Mints a real browser session for a user and returns it as the Cookie header
// the app's own routes expect (@supabase/ssr's chunked `sb-<ref>-auth-token`).
//
// Why: the generation pipeline lives behind /api/generate, a 2000-line route
// built around the logged-in request (session client, admin billing bypass,
// diagnostics, persistence, the stage stream). Autopilot reuses it by calling
// the route as the plan's owner instead of refactoring its core out — the same
// separation that keeps /api/product and /api/suggest from touching it.
//
// SECURITY: this can log in as ANY user. It is only reachable from routes that
// have already passed the admin allow-list (the plan owner IS an admin) and
// from the CRON_SECRET-guarded cron, and it only ever mints the plan owner's
// own session. Never expose it to a client-supplied user id.

const CHUNK = 3180; // @supabase/ssr MAX_CHUNK_SIZE

function base64Url(s: string): string {
  return Buffer.from(s, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export async function mintSessionCookie(admin: SupabaseClient, userId: string): Promise<string> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishable = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !publishable) throw new Error("Supabase URL / publishable key not configured.");

  const { data: u, error: uErr } = await admin.auth.admin.getUserById(userId);
  const email = u?.user?.email;
  if (uErr || !email) throw new Error(`Autopilot: user ${userId} has no email (${uErr?.message ?? "not found"}).`);

  const { data: link, error: lErr } = await admin.auth.admin.generateLink({ type: "magiclink", email });
  const tokenHash = link?.properties?.hashed_token;
  if (lErr || !tokenHash) throw new Error(`Autopilot: could not mint a session (${lErr?.message ?? "no token"}).`);

  const anon = createSupabaseClient(url, publishable, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const { data: v, error: vErr } = await anon.auth.verifyOtp({ token_hash: tokenHash, type: "magiclink" });
  if (vErr || !v.session) throw new Error(`Autopilot: session verify failed (${vErr?.message ?? "no session"}).`);

  const ref = new URL(url).hostname.split(".")[0];
  const name = `sb-${ref}-auth-token`;
  const value = `base64-${base64Url(JSON.stringify(v.session))}`;
  const pairs: string[] = [];
  if (value.length <= CHUNK) {
    pairs.push(`${name}=${value}`);
  } else {
    for (let i = 0, k = 0; i < value.length; i += CHUNK, k++) {
      pairs.push(`${name}.${k}=${value.slice(i, i + CHUNK)}`);
    }
  }
  return pairs.join("; ");
}
