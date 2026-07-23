"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/utils/supabase/server";

// The standalone /login and /signup pages (and their form actions) were removed
// 2026-07-22 — the landing page modals sign in via the browser client instead.
// Only the sign-out action lives here now; it lands on the landing page.

export async function signout() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  revalidatePath("/", "layout");
  redirect("/");
}
