import { Logo } from "./Logo";

const LINKS = [
  { label: "How it works", href: "/#how-it-works" },
  { label: "Demo", href: "/#demo" },
  { label: "Benefits", href: "/#benefits" },
  { label: "Guides", href: "/guides" },
  { label: "Log in", href: "/login" },
  { label: "Privacy", href: "/privacy" },
  { label: "Terms", href: "/terms" },
];

export function Footer() {
  return (
    <footer className="mt-auto border-t border-border bg-surface">
      <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-6 px-5 py-10 sm:flex-row sm:px-8">
        <Logo />
        <nav className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2">
          {LINKS.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className="text-sm text-muted transition-colors hover:text-accent-text"
            >
              {link.label}
            </a>
          ))}
        </nav>
        <p className="text-sm text-muted">
          © {new Date().getFullYear()} SlideShowAI
        </p>
      </div>
    </footer>
  );
}
