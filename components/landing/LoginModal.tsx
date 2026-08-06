"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Modal } from "@/components/ui/Modal";
import { GoogleButton } from "@/components/auth/GoogleButton";
import { AuthTransition } from "@/components/auth/AuthTransition";
import { createClient } from "@/utils/supabase/client";
import { inputClass, submitClass, bannerError } from "@/components/auth/styles";

// In-place login for the landing page: same form as /login, but signs in via
// the browser client so errors render inline and success lands straight on
// the dashboard — no page hop.
export function LoginModal({
  open,
  onClose,
  onSwitchToSignup,
}: {
  open: boolean;
  onClose: () => void;
  onSwitchToSignup: () => void;
}) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  // Held from a successful sign-in until the dashboard actually renders, so the
  // landing page never shows through behind the modal during the wait.
  const [leaving, setLeaving] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (loading) return;
    setLoading(true);
    setError("");
    const fd = new FormData(e.currentTarget);
    const supabase = createClient();
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: String(fd.get("email") ?? "").trim(),
      password: String(fd.get("password") ?? ""),
    });
    if (signInError) {
      setError(signInError.message);
      setLoading(false);
      return;
    }
    // Cover the page BEFORE navigating. router.push to a dynamic server route
    // takes a beat to fetch, and until this the landing page sat visible behind
    // the modal for that whole time, then jumped — one action, two screens.
    setLeaving(true);
    router.push("/dashboard");
    router.refresh();
  }

  // Once sign-in succeeds the modal and the landing behind it are gone; this is
  // the only thing on screen until the dashboard replaces it.
  if (leaving) return <AuthTransition />;

  return (
    <Modal open={open} onClose={onClose} title="Welcome back" width="max-w-sm">
      <p className="-mt-3 text-sm text-muted">
        Log in to your SlideLabsAI account.
      </p>

      {error && <p className={bannerError}>{error}</p>}

      <div className="mt-5">
        <GoogleButton returnTo="/dashboard" />
      </div>

      <div className="my-5 flex items-center gap-3">
        <span className="h-px flex-1 bg-border" />
        <span className="text-xs text-muted">or</span>
        <span className="h-px flex-1 bg-border" />
      </div>

      <form onSubmit={onSubmit} className="space-y-4">
        <div>
          <label htmlFor="modal-email" className="mb-1.5 block text-sm font-medium">
            Email
          </label>
          <input
            id="modal-email"
            name="email"
            type="email"
            required
            autoComplete="email"
            placeholder="you@business.com"
            className={inputClass}
          />
        </div>
        <div>
          <label htmlFor="modal-password" className="mb-1.5 block text-sm font-medium">
            Password
          </label>
          <input
            id="modal-password"
            name="password"
            type="password"
            required
            autoComplete="current-password"
            placeholder="••••••••"
            className={inputClass}
          />
        </div>
        <button type="submit" disabled={loading} className={submitClass}>
          {loading ? "Logging in…" : "Log in"}
        </button>
      </form>

      <p className="mt-5 text-center text-sm text-muted">
        Don&apos;t have an account?{" "}
        <button
          type="button"
          onClick={onSwitchToSignup}
          className="font-semibold text-accent-text hover:underline"
        >
          Sign up
        </button>
      </p>
    </Modal>
  );
}
