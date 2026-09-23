import { NextResponse } from "next/server";
import type { User } from "@supabase/supabase-js";
import { createClient } from "@/utils/supabase/server";
import { isAdminEmail } from "@/lib/admins";

/**
 * Admin API gate: the session user's email against the allow-list — the same
 * check the admin pages make. Non-admins get the 404 the pages give, so a
 * route's existence leaks nothing. Never reads anything from the body.
 */
export async function requireAdmin(): Promise<{ user: User; response?: undefined } | { user?: undefined; response: Response }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || !isAdminEmail(user.email)) {
    return { response: NextResponse.json({ error: "Not found." }, { status: 404 }) };
  }
  return { user };
}
