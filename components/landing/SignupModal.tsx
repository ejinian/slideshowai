"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Modal } from "@/components/ui/Modal";
import { GoogleButton } from "@/components/auth/GoogleButton";
import { AuthTransition } from "@/components/auth/AuthTransition";
import { createClient } from "@/utils/supabase/client";
import { inputClass, submitClass, bannerError, bannerInfo } from "@/components/auth/styles";

// In-place signup for the landing page: same form as /signup, but registers via
// the browser client so errors render inline and success lands straight on the
// dashboard — no page hop. Mirrors LoginModal.
export function SignupModal({
  open,
  onClose,
  onSwitchToLogin,
}: {
  open: boolean;
  onClose: () => void;
  onSwitchToLogin: () => void;
}) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [loading, setLoading] = useState(false);
  // Held from a successful sign-in until the dashboard actually renders, so the
  // landing page never shows through behind the modal during the wait.
  const [leaving, setLeaving] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (loading) return;
    setError("");
    setInfo("");

    const fd = new FormData(e.currentTarget);
    const email = String(fd.get("email") ?? "").trim();
    const password = String(fd.get("password") ?? "");
    const confirmPassword = String(fd.get("confirm_password") ?? "");

    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    setLoading(true);
    const supabase = createClient();
    const { data, error: signUpError } = await supabase.auth.signUp({
      email,
      password,
    });
    if (signUpError) {
      setError(signUpError.message);
      setLoading(false);
      return;
    }

    // Email confirmation OFF → signUp returns a session → signed in immediately.
    if (data.session) {
      // Cover the page before navigating, so the landing doesn't sit visible
      // behind the modal while the dashboard route is fetched.
      setLeaving(true);
      router.push("/dashboard");
      router.refresh();
      return;
    }

    // Email confirmation ON → no session yet; prompt to confirm then log in.
    setInfo(
      "Account created. If email confirmation is on, confirm via the emailed link first, then log in.",
    );
    setLoading(false);
  }

  // Once the account is live the modal and the landing behind it are gone; this
  // is the only thing on screen until the dashboard replaces it.
  if (leaving) return <AuthTransition label="Setting up your account" />;

  return (
    <Modal open={open} onClose={onClose} title="Create your account" width="max-w-sm">
      <p className="-mt-3 text-sm text-muted">
        Start generating TikTok slideshows for your business.
      </p>

      {info && <p className={bannerInfo}>{info}</p>}
      {error && <p className={bannerError}>{error}</p>}

      <div className="mt-5">
        <GoogleButton returnTo="/dashboard" label="Sign up with Google" />
      </div>

      <div className="my-5 flex items-center gap-3">
        <span className="h-px flex-1 bg-border" />
        <span className="text-xs text-muted">or</span>
        <span className="h-px flex-1 bg-border" />
      </div>

      <form onSubmit={onSubmit} className="space-y-4">
        <div>
          <label htmlFor="signup-email" className="mb-1.5 block text-sm font-medium">
            Email
          </label>
          <input
            id="signup-email"
            name="email"
            type="email"
            required
            autoComplete="email"
            placeholder="you@business.com"
            className={inputClass}
          />
        </div>
        <div>
          <label htmlFor="signup-password" className="mb-1.5 block text-sm font-medium">
            Password
          </label>
          <input
            id="signup-password"
            name="password"
            type="password"
            required
            minLength={6}
            autoComplete="new-password"
            placeholder="At least 6 characters"
            className={inputClass}
          />
        </div>
        <div>
          <label htmlFor="signup-confirm" className="mb-1.5 block text-sm font-medium">
            Confirm password
          </label>
          <input
            id="signup-confirm"
            name="confirm_password"
            type="password"
            required
            minLength={6}
            autoComplete="new-password"
            placeholder="Re-enter your password"
            className={inputClass}
          />
        </div>
        <button type="submit" disabled={loading} className={submitClass}>
          {loading ? "Creating account…" : "Create account"}
        </button>
      </form>

      <p className="mt-5 text-center text-sm text-muted">
        Already have an account?{" "}
        <button
          type="button"
          onClick={onSwitchToLogin}
          className="font-semibold text-accent-text hover:underline"
        >
          Log in
        </button>
      </p>
    </Modal>
  );
}
