"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/utils/supabase/client";

// Safety net for the Google "double login" glitch.
//
// If Supabase doesn't recognize the OAuth `redirectTo` (e.g. this deployment's
// `/auth/callback` isn't in the project's Redirect URLs allowlist), it falls
// back to the Site URL — the landing page — and appends `?code=...` (or an
// `#access_token=...` hash). Nothing on the landing page would otherwise consume
// that, so the user appears logged out and has to sign in a second time.
//
// This component runs ONLY when such an auth param is present in the URL: the
// browser client's `detectSessionInUrl` exchanges the code on mount, and once a
// session exists we forward to the intended destination. Normal (non-OAuth)
// visits to the landing page are untouched — logged-in users are not redirected.
export function SessionRedirect({ to = "/dashboard" }: { to?: string }) {
  const router = useRouter();

  useEffect(() => {
    const url = new URL(window.location.href);
    const hasAuthParam =
      url.searchParams.has("code") || url.hash.includes("access_token");
    if (!hasAuthParam) return;

    const supabase = createClient();
    let done = false;
    const go = () => {
      if (done) return;
      done = true;
      router.replace(to);
      router.refresh();
    };

    // The code exchange kicked off by `detectSessionInUrl` is async; catch it
    // both by polling the current session and by listening for the sign-in.
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) go();
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session) go();
    });

    return () => sub.subscription.unsubscribe();
  }, [router, to]);

  return null;
}
