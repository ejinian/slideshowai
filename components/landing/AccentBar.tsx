// Short gradient rule under section headers — grows in when the section
// reveals (see .accent-bar in globals; reduced-motion shows it full-width).
export function AccentBar() {
  return (
    <span
      aria-hidden
      className="accent-bar mt-4 block h-1 rounded-full bg-linear-to-r from-accent to-fuchsia-500"
    />
  );
}
