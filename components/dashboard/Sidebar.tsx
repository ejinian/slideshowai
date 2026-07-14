"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Logo } from "@/components/landing/Logo";
import { ActivationChecklist } from "@/components/dashboard/grow/ActivationChecklist";
import { signout } from "@/app/login/actions";

type NavItem = { label: string; href: string; icon: React.ReactNode };

const NAV: NavItem[] = [
  {
    label: "Slideshows",
    href: "/dashboard/slideshows",
    icon: (
      <>
        <rect x="3" y="5" width="18" height="14" rx="2" />
        <path d="M10 9l5 3-5 3z" />
      </>
    ),
  },
  {
    label: "Image Library",
    href: "/dashboard/images",
    icon: (
      <>
        <rect x="3" y="5" width="18" height="14" rx="2" />
        <circle cx="8.5" cy="10" r="1.5" />
        <path d="M21 16l-5-5-8 8" />
      </>
    ),
  },
  {
    label: "Settings",
    href: "#",
    icon: (
      <>
        <circle cx="12" cy="12" r="3" />
        <path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1" />
      </>
    ),
  },
];

// The Grow feature set — trends, inspiration, assets, scheduling, results.
const GROW_NAV: NavItem[] = [
  {
    label: "Trends",
    href: "/dashboard/trends",
    icon: (
      <>
        <path d="M3 17l6-6 4 4 8-8" />
        <path d="M14 7h7v7" />
      </>
    ),
  },
  {
    label: "Inspiration",
    href: "/dashboard/inspiration",
    icon: (
      <>
        <path d="M12 2a7 7 0 0 0-4 12.7c.6.5 1 1.2 1 2V18h6v-1.3c0-.8.4-1.5 1-2A7 7 0 0 0 12 2z" />
        <path d="M9 21h6" />
      </>
    ),
  },
  {
    label: "Collections",
    href: "/dashboard/collections",
    icon: (
      <>
        <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z" />
      </>
    ),
  },
  {
    label: "Schedule",
    href: "/dashboard/schedule",
    icon: (
      <>
        <rect x="3" y="4" width="18" height="17" rx="2" />
        <path d="M3 9h18M8 2v4M16 2v4" />
      </>
    ),
  },
  {
    label: "Analytics",
    href: "/dashboard/analytics",
    icon: (
      <>
        <path d="M4 20V10M10 20V4M16 20v-9M22 20H2" />
      </>
    ),
  },
];

function NavSection({
  title,
  items,
  pathname,
}: {
  title: string;
  items: NavItem[];
  pathname: string;
}) {
  return (
    <>
      <span className="px-3 text-xs font-semibold uppercase tracking-wide text-muted">
        {title}
      </span>
      <div className="mt-2 space-y-1">
        {items.map((item) => {
          const active =
            item.href !== "#" &&
            (pathname === item.href || pathname.startsWith(item.href + "/"));
          return (
            <Link
              key={item.label}
              href={item.href}
              className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                active
                  ? "bg-accent/15 text-accent-text"
                  : "text-muted hover:bg-card hover:text-foreground"
              }`}
            >
              <NavIcon>{item.icon}</NavIcon>
              {item.label}
            </Link>
          );
        })}
      </div>
    </>
  );
}

function NavIcon({ children }: { children: React.ReactNode }) {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {children}
    </svg>
  );
}

export function Sidebar({
  businessName,
  email,
  plan = "free",
}: {
  businessName: string | null;
  email: string | null;
  plan?: string;
}) {
  const pathname = usePathname();
  const onCreate = pathname === "/dashboard";
  const [menuOpen, setMenuOpen] = useState(false);
  const [upgrading, setUpgrading] = useState(false);
  const [managing, setManaging] = useState(false);
  const isPro = plan === "pro";

  async function upgrade() {
    setUpgrading(true);
    try {
      const res = await fetch("/api/stripe/checkout", { method: "POST" });
      const data = (await res.json()) as { url?: string; error?: string };
      if (data.url) {
        window.location.href = data.url;
        return; // leaving the page — keep the button in its loading state
      }
      console.error("Checkout failed:", data.error);
    } catch (e) {
      console.error("Checkout request failed:", e);
    }
    setUpgrading(false);
  }

  // Opens the Stripe Billing Portal so a Pro user can manage/cancel.
  async function manageBilling() {
    setManaging(true);
    try {
      const res = await fetch("/api/stripe/portal", { method: "POST" });
      const data = (await res.json()) as { url?: string; error?: string };
      if (data.url) {
        window.location.href = data.url;
        return; // leaving the page — keep the button in its loading state
      }
      console.error("Portal failed:", data.error);
    } catch (e) {
      console.error("Portal request failed:", e);
    }
    setManaging(false);
  }

  return (
    <aside className="hidden w-64 shrink-0 flex-col border-r border-border bg-surface lg:flex">
      <div className="flex h-16 items-center px-5">
        <Logo href="/dashboard" />
      </div>

      <div className="px-3">
        <Link
          href="/dashboard"
          className={`flex w-full items-center justify-center gap-2 rounded-full px-4 py-2.5 text-sm font-semibold transition-colors ${
            onCreate
              ? "bg-accent text-accent-foreground shadow-lg shadow-accent/25 hover:bg-accent-strong"
              : "border border-border bg-card text-foreground hover:border-accent hover:text-accent-text"
          }`}
        >
          <span aria-hidden className="text-base leading-none">+</span>
          Create Slideshow
        </Link>
      </div>

      <nav className="mt-5 flex-1 overflow-y-auto px-3">
        <NavSection title="Workspace" items={NAV} pathname={pathname} />
        <div className="mt-6">
          <NavSection title="Grow" items={GROW_NAV} pathname={pathname} />
        </div>
      </nav>

      {/* Onboarding checklist */}
      <div className="px-3 pb-3">
        <ActivationChecklist />
      </div>

      {/* Plan / billing */}
      <div className="px-3">
        <div className="rounded-xl border border-border bg-card p-4">
          {isPro ? (
            <>
              <p className="text-sm font-semibold">Pro plan</p>
              <p className="mt-0.5 text-xs text-muted">Unlimited slideshows</p>
              <button
                type="button"
                onClick={manageBilling}
                disabled={managing}
                className="mt-3 w-full rounded-full border border-border bg-surface px-4 py-2 text-xs font-semibold text-foreground transition-colors hover:border-accent hover:text-accent-text disabled:opacity-60"
              >
                {managing ? "Opening…" : "Manage billing"}
              </button>
            </>
          ) : (
            <>
              <p className="text-sm font-semibold">Free plan</p>
              <p className="mt-0.5 text-xs text-muted">Upgrade for unlimited slideshows</p>
              <button
                type="button"
                onClick={upgrade}
                disabled={upgrading}
                className="mt-3 w-full rounded-full bg-linear-to-r from-fuchsia-500 to-accent px-4 py-2 text-xs font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-60"
              >
                {upgrading ? "Redirecting…" : "Upgrade to Pro"}
              </button>
            </>
          )}
        </div>
      </div>

      {/* User */}
      <div className="mt-3 border-t border-border p-3">
        {email ? (
          <div className="relative">
            <button
              type="button"
              onClick={() => setMenuOpen((o) => !o)}
              className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left transition-colors hover:bg-card"
            >
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-linear-to-br from-accent to-fuchsia-500 text-sm font-bold uppercase text-white">
                {(businessName || email).charAt(0)}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold">
                  {businessName || "Your business"}
                </span>
                <span className="block truncate text-xs text-muted">{email}</span>
              </span>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-muted" aria-hidden>
                <path d="M8 9l4-4 4 4M16 15l-4 4-4-4" />
              </svg>
            </button>

            {menuOpen ? (
              <>
                <button
                  type="button"
                  aria-hidden
                  tabIndex={-1}
                  onClick={() => setMenuOpen(false)}
                  className="fixed inset-0 z-40 cursor-default"
                />
                <div className="absolute bottom-full left-0 right-0 z-50 mb-2 rounded-lg border border-border bg-card p-1 shadow-xl">
                  <form action={signout}>
                    <button
                      type="submit"
                      className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm font-medium text-foreground transition-colors hover:bg-surface"
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                        <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" />
                      </svg>
                      Sign out
                    </button>
                  </form>
                </div>
              </>
            ) : null}
          </div>
        ) : (
          <Link
            href="/login"
            className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left transition-colors hover:bg-card"
          >
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-card text-sm font-bold text-muted">
              ?
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-semibold">Guest</span>
              <span className="block truncate text-xs text-muted">Sign in to save</span>
            </span>
          </Link>
        )}
      </div>
    </aside>
  );
}
