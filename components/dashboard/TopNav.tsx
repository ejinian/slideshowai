"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Logo } from "@/components/landing/Logo";
import { signout } from "@/app/login/actions";
import { type BillingUsage } from "@/components/dashboard/BillingModal";
import { SidebarBody } from "@/components/dashboard/Sidebar";

export function TopNav({
  email,
  businessName,
  usage,
  tiktokConnected = false,
}: {
  email: string | null;
  businessName: string | null;
  usage?: BillingUsage;
  tiktokConnected?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [navOpen, setNavOpen] = useState(false);
  const pathname = usePathname();
  const onSlideshows = pathname.startsWith("/dashboard/slideshows");

  // The bar is sticky, so page content used to scroll straight under a fully
  // transparent header. Stay transparent at the top (it floats over the hero
  // gradient there, which is the intended look) and go solid black the moment
  // anything scrolls beneath it.
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 4);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header
      className={`sticky top-0 z-30 h-14 transition-colors duration-200 lg:hidden ${
        scrolled ? "border-b border-white/8 bg-black" : "bg-transparent"
      }`}
    >
      <div className="mx-auto flex h-full max-w-5xl items-center justify-between px-6">
        <div className="flex items-center gap-2">
          {/* mobile nav drawer trigger */}
          <div className="relative">
            <button
              type="button"
              aria-label="Open navigation"
              onClick={() => setNavOpen((o) => !o)}
              className="grid h-8 w-8 place-items-center rounded-full text-white/60 transition-colors hover:bg-white/10 hover:text-white"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
                <path d="M4 7h16M4 12h16M4 17h16" />
              </svg>
            </button>
            {navOpen && (
              <>
                <button
                  type="button"
                  aria-hidden
                  tabIndex={-1}
                  onClick={() => setNavOpen(false)}
                  className="fixed inset-0 z-40 cursor-default bg-black/50"
                />
                {/* Full-height slide-in rail — renders the SAME body as the
                    desktop sidebar (nav + checklist + plan + account) rather
                    than a trimmed-down dropdown. */}
                <div className="animate-drawer-in fixed inset-y-0 left-0 z-50 w-[17rem] max-w-[85vw] overflow-y-auto border-r border-border shadow-2xl">
                  {usage && (
                    <SidebarBody
                      businessName={businessName}
                      email={email}
                      usage={usage}
                      showChecklist={false}
                      tiktokConnected={tiktokConnected}
                      onNavigate={() => setNavOpen(false)}
                    />
                  )}
                </div>
              </>
            )}
          </div>
          <Logo href="/dashboard" />
        </div>

        <nav className="flex items-center gap-1">
          <Link
            href="/dashboard"
            className={`hidden rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors sm:block ${
              pathname === "/dashboard"
                ? "bg-white/15 text-white"
                : "text-white/50 hover:text-white/80"
            }`}
          >
            Generate
          </Link>
          <Link
            href="/dashboard/slideshows"
            className={`hidden rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors sm:block ${
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
                className="grid h-8 w-8 place-items-center rounded-full bg-linear-to-br from-accent to-violet-500 text-xs font-bold text-white ring-1 ring-white/20 transition-opacity hover:opacity-90"
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
                  <div className="absolute right-0 top-full z-50 mt-2 w-52 overflow-hidden rounded-xl border border-white/8 bg-[#111]/95 shadow-2xl backdrop-blur-lg">
                    <div className="border-b border-white/6 px-3 py-3">
                      <p className="truncate text-xs font-semibold text-white">
                        {businessName || "Your account"}
                      </p>
                      <p className="truncate text-[11px] text-white/35">{email}</p>
                    </div>
                    <div className="p-1">
                      <form action={signout}>
                        <button
                          type="submit"
                          className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-xs text-white/50 transition-colors hover:bg-white/6 hover:text-white"
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
                href="/?auth=login"
                className="rounded-lg px-3.5 py-1.5 text-sm font-medium text-white/60 transition-colors hover:text-white"
              >
                Log in
              </Link>
              <Link
                href="/?auth=signup"
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
