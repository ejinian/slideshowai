import Link from "next/link";
import { Logo } from "@/components/landing/Logo";
import { GoogleButton } from "@/components/auth/GoogleButton";
import { signup } from "@/app/login/actions";
import { inputClass, submitClass, bannerError } from "@/components/auth/styles";

export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const sp = await searchParams;

  return (
    <main className="bg-hero-glow flex min-h-screen flex-col items-center justify-center px-5 py-12">
      <div className="animate-rise w-full max-w-sm">
        <div className="mb-8 flex justify-center">
          <Logo />
        </div>

        <div className="rounded-card border border-white/10 bg-card/80 p-7 shadow-2xl shadow-black/60 backdrop-blur-xl">
          <h1 className="text-2xl font-bold tracking-tight">Create your account</h1>
          <p className="mt-1 text-sm text-muted">
            Start generating TikTok slideshows for your business.
          </p>

          {sp.error ? <p className={bannerError}>{sp.error}</p> : null}

          <div className="mt-6">
            <GoogleButton returnTo="/dashboard" label="Sign up with Google" />
          </div>

          <div className="my-5 flex items-center gap-3">
            <span className="h-px flex-1 bg-border" />
            <span className="text-xs text-muted">or</span>
            <span className="h-px flex-1 bg-border" />
          </div>

          <form action={signup} className="space-y-4">
            <div>
              <label htmlFor="email" className="mb-1.5 block text-sm font-medium">
                Email
              </label>
              <input
                id="email"
                name="email"
                type="email"
                required
                autoComplete="email"
                placeholder="you@business.com"
                className={inputClass}
              />
            </div>
            <div>
              <label htmlFor="password" className="mb-1.5 block text-sm font-medium">
                Password
              </label>
              <input
                id="password"
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
              <label htmlFor="confirm_password" className="mb-1.5 block text-sm font-medium">
                Confirm password
              </label>
              <input
                id="confirm_password"
                name="confirm_password"
                type="password"
                required
                minLength={6}
                autoComplete="new-password"
                placeholder="Re-enter your password"
                className={inputClass}
              />
            </div>
            <button type="submit" className={submitClass}>
              Create account
            </button>
          </form>
        </div>

        <p className="mt-6 text-center text-sm text-muted">
          Already have an account?{" "}
          <Link href="/login" className="font-semibold text-accent-text hover:underline">
            Log in
          </Link>
        </p>
      </div>
    </main>
  );
}
