"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/utils/supabase/server";

export async function login(formData: FormData) {
  const supabase = await createClient();
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");

  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    redirect(`/login?error=${encodeURIComponent(error.message)}`);
  }

  revalidatePath("/", "layout");
  redirect("/dashboard");
}

export async function signup(formData: FormData) {
  const supabase = await createClient();
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const businessName = String(formData.get("business_name") ?? "");

  if (!email || !password) {
    redirect(
      "/signup?error=" + encodeURIComponent("Email and password are required."),
    );
  }

  // Standard signup with the publishable key — no secret key needed.
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { business_name: businessName } },
  });
  if (error) {
    redirect(`/signup?error=${encodeURIComponent(error.message)}`);
  }

  // Email confirmation OFF → signUp returns a session → signed in immediately.
  if (data.session) {
    revalidatePath("/", "layout");
    redirect("/dashboard");
  }

  // Email confirmation ON → no session yet; send them to log in.
  redirect(
    "/login?message=" +
      encodeURIComponent(
        "Account created. If email confirmation is on, confirm via the emailed link first, then log in.",
      ),
  );
}

export async function signout() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  revalidatePath("/", "layout");
  redirect("/login");
}
