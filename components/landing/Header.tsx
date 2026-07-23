"use client";

import { useEffect, useState } from "react";
import { Logo } from "./Logo";
import { Button } from "../ui/Button";
import { LoginModal } from "./LoginModal";
import { SignupModal } from "./SignupModal";

export function Header() {
  const [scrolled, setScrolled] = useState(false);
  const [authView, setAuthView] = useState<"login" | "signup" | null>(null);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header
      className={`sticky top-0 z-50 transition-all duration-300 ${
        scrolled
          ? "border-b border-border/70 bg-background/80 shadow-lg shadow-black/20 backdrop-blur-md"
          : "border-b border-transparent bg-transparent"
      }`}
    >
      <div className="relative mx-auto flex h-16 max-w-6xl items-center justify-between px-5 sm:px-8">
        <Logo />

        {/* center nav — desktop only */}
        <nav className="absolute left-1/2 hidden -translate-x-1/2 items-center gap-8 lg:flex">
          {[
            // "/#..." (not "#...") so the anchors also work from /guides pages.
            { label: "How it works", href: "/#how-it-works" },
            { label: "Pricing", href: "/#pricing" },
            { label: "FAQ", href: "/#faq" },
            { label: "Guides", href: "/guides" },
          ].map((link) => (
            <a
              key={link.href}
              href={link.href}
              className="text-sm font-medium text-muted transition-colors hover:text-foreground"
            >
              {link.label}
            </a>
          ))}
        </nav>

        <div className="flex items-center gap-4">
          <button
            type="button"
            onClick={() => setAuthView("login")}
            className="hidden text-sm font-medium text-muted transition-colors hover:text-foreground sm:block"
          >
            Log in
          </button>
          <Button
            href="/signup"
            size="md"
            variant="cta"
            onClick={(e) => {
              e.preventDefault();
              setAuthView("signup");
            }}
          >
            Create a slideshow
          </Button>
        </div>
      </div>

      <LoginModal
        open={authView === "login"}
        onClose={() => setAuthView(null)}
        onSwitchToSignup={() => setAuthView("signup")}
      />
      <SignupModal
        open={authView === "signup"}
        onClose={() => setAuthView(null)}
        onSwitchToLogin={() => setAuthView("login")}
      />
    </header>
  );
}
