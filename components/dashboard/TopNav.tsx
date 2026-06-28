"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Logo } from "@/components/landing/Logo";
import { signout } from "@/app/login/actions";

export function TopNav({
  email,
  businessName,
}: {
  email: string | null;
  businessName: string | null;
}) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const onSlideshows = pathname.startsWith("/dashboard/slideshows");

  return (
    <header className="sticky top-0 z-30 h-14 bg-transparent">
      <div className="mx-auto flex h-full max-w-5xl items-center justify-between px-6">
        <Logo href="/dashboard" />

        <nav className="flex items-center gap-1">
          <Link
            href="/dashboard"
            className={`rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors ${
              pathname === "/dashboard"
                ? "bg-white/15 text-white"
                : "text-white/50 hover:text-white/80"
            }`}
          >
            Generate
          </Link>
          <Link
            href="/dashboard/slideshows"
            className={`rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors ${
              onSlideshows
                ? "bg-white/15 text-white"
                : "text-white/50 hover:text-white/80"
            }`}
          >
            My Slideshows
          </Link>

          {email ? (
            <div className="relative ml-4">
              <button
                type="button"
                onClick={() => setOpen((o) => !o)}
                className="grid h-8 w-8 place-items-center rounded-full bg-gradient-to-br from-accent to-violet-500 text-xs font-bold text-white ring-1 ring-white/20 transition-opacity hover:opacity-90"
              >
                {(businessName || email).charAt(0).toUpperCase()}
              </button>

              {open && (
                <>
                  <button
                    type="button"
                    aria-hidden
                    tabIndex={-1}
                    onClick={() => setOpen(false)}
                    className="fixed inset-0 z-40 cursor-default"
                  />
                  <div className="absolute right-0 top-full z-50 mt-2 w-52 overflow-hidden rounded-xl border border-white/[0.08] bg-[#111]/95 shadow-2xl backdrop-blur-lg">
                    <div className="border-b border-white/[0.06] px-3 py-3">
                      <p className="truncate text-xs font-semibold text-white">
                        {businessName || "Your account"}
                      </p>
                      <p className="truncate text-[11px] text-white/35">{email}</p>
                    </div>
                    <div className="p-1">
                      <form action={signout}>
                        <button
                          type="submit"
                          className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-xs text-white/50 transition-colors hover:bg-white/[0.06] hover:text-white"
                        >
                          Sign out
                        </button>
                      </form>
                    </div>
                  </div>
                </>
              )}
            </div>
          ) : (
            <div className="ml-4 flex items-center gap-2">
              <Link
                href="/login"
                className="rounded-lg px-3.5 py-1.5 text-sm font-medium text-white/60 transition-colors hover:text-white"
              >
                Log in
              </Link>
              <Link
                href="/signup"
                className="rounded-lg bg-white px-4 py-1.5 text-sm font-semibold text-black transition-opacity hover:opacity-90"
              >
                Get started
              </Link>
            </div>
          )}
        </nav>
      </div>
    </header>
  );
}
