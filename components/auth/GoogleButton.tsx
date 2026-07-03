"use client";

import { useState } from "react";
import { createClient } from "@/utils/supabase/client";

// "Continue with Google" — kicks off the OAuth redirect via the browser client.
// Supabase bounces the user to Google, then back to /auth/callback (see that
// route), which exchanges the code for a session and forwards to `returnTo`.
export function GoogleButton({
  returnTo = "/dashboard",
  label = "Continue with Google",
}: {
  returnTo?: string;
  label?: string;
}) {
  const [loading, setLoading] = useState(false);

  async function signIn() {
    setLoading(true);
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(returnTo)}`,
      },
    });
    // On success the browser is already navigating away; only reset on failure.
    if (error) setLoading(false);
  }

  return (
    <button
      type="button"
      onClick={signIn}
      disabled={loading}
      className="flex w-full items-center justify-center gap-2.5 rounded-full border border-border bg-background px-5 py-2.5 text-sm font-semibold text-foreground transition-colors hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-60"
    >
      <svg width="17" height="17" viewBox="0 0 24 24" aria-hidden>
        <path
          fill="#4285F4"
          d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1Z"
        />
        <path
          fill="#34A853"
          d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23Z"
        />
        <path
          fill="#FBBC05"
          d="M5.84 14.09a6.6 6.6 0 0 1 0-4.18V7.07H2.18a11 11 0 0 0 0 9.86l3.66-2.84Z"
        />
        <path
          fill="#EA4335"
          d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1A11 11 0 0 0 2.18 7.07l3.66 2.84C6.71 7.31 9.14 5.38 12 5.38Z"
        />
      </svg>
      {loading ? "Redirecting…" : label}
    </button>
  );
}
