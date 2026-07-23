import type { AnchorHTMLAttributes } from "react";

type Variant = "primary" | "secondary" | "onAccent" | "white" | "cta";
type Size = "md" | "lg";

const base =
  "inline-flex items-center justify-center gap-2 rounded-full font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 focus-visible:ring-offset-2";

const variants: Record<Variant, string> = {
  primary:
    "bg-accent text-accent-foreground shadow-lg shadow-accent/25 hover:bg-accent-strong",
  secondary:
    "bg-card text-foreground border border-border hover:border-accent hover:text-accent-text",
  // White pill intended to sit on the accent-colored CTA band.
  onAccent: "bg-white text-accent shadow-lg shadow-black/20 hover:bg-white/90",
  // Monochrome landing CTA (DESIGN.md): white pill, black text, no glow.
  white: "bg-white text-black hover:bg-white/85",
  // THE landing CTA (DESIGN.md): brand gradient + periodic shine, one action only.
  cta: "btn-shine bg-linear-to-r from-accent to-fuchsia-500 text-white shadow-lg shadow-accent/30 transition-all hover:brightness-110 hover:scale-[1.03] active:scale-95",
};

const sizes: Record<Size, string> = {
  md: "px-5 py-2.5 text-sm",
  lg: "px-7 py-3.5 text-base",
};

interface ButtonProps extends AnchorHTMLAttributes<HTMLAnchorElement> {
  variant?: Variant;
  size?: Size;
}

export function Button({
  variant = "primary",
  size = "md",
  className = "",
  children,
  ...props
}: ButtonProps) {
  return (
    <a
      className={`${base} ${variants[variant]} ${sizes[size]} ${className}`}
      {...props}
    >
      {children}
    </a>
  );
}
