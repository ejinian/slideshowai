import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/utils/supabase/server";

// OAuth (Google) redirect target. Supabase sends the user back here with a
// `?code=` after they approve on Google; we exchange it for a session cookie
// and forward them on to `next` (defaults to the dashboard).
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/dashboard";

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      // In prod (behind Vercel's proxy) trust the forwarded host so the
      // redirect lands on the real domain, not the internal origin.
      const forwardedHost = request.headers.get("x-forwarded-host");
      const isLocal = process.env.NODE_ENV === "development";
      if (!isLocal && forwardedHost) {
        return NextResponse.redirect(`https://${forwardedHost}${next}`);
      }
      return NextResponse.redirect(`${origin}${next}`);
    }
  }

  return NextResponse.redirect(
    `${origin}/login?error=${encodeURIComponent("Google sign-in failed or was cancelled.")}`,
  );
}
