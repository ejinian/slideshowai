import Link from "next/link";
import { Logo } from "@/components/landing/Logo";
import { login } from "./actions";
import { inputClass, submitClass, bannerInfo, bannerError } from "@/components/auth/styles";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; message?: string }>;
}) {
  const sp = await searchParams;

  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-5 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex justify-center">
          <Logo />
        </div>

        <div className="rounded-card border border-border bg-card p-7 shadow-xl">
          <h1 className="text-2xl font-bold tracking-tight">Welcome back</h1>
          <p className="mt-1 text-sm text-muted">Log in to your SlideShowAI account.</p>

          {sp.message ? <p className={bannerInfo}>{sp.message}</p> : null}
          {sp.error ? <p className={bannerError}>{sp.error}</p> : null}

          <form action={login} className="mt-6 space-y-4">
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
                autoComplete="current-password"
                placeholder="••••••••"
                className={inputClass}
              />
            </div>
            <button type="submit" className={submitClass}>
              Log in
            </button>
          </form>
        </div>

        <p className="mt-6 text-center text-sm text-muted">
          Don&apos;t have an account?{" "}
          <Link href="/signup" className="font-semibold text-accent-text hover:underline">
            Sign up
          </Link>
        </p>
      </div>
    </main>
  );
}
