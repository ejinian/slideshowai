import type { ReactNode } from "react";
import type { MdBlock } from "@/lib/guides";

// Renderer for the constrained guide-markdown subset (lib/guides.ts).
// Inline support: **bold**, `code`, [text](href). Internal links stay same-tab;
// external links open in a new tab.

function renderInline(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  // tokenize links first, then bold/code inside the remaining text
  const parts = text.split(/(\[[^\]]+\]\([^)]+\))/g);
  parts.forEach((part, pi) => {
    const link = part.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
    if (link) {
      const external = /^https?:\/\//.test(link[2]);
      out.push(
        <a
          key={pi}
          href={link[2]}
          {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
          className="font-medium text-accent-text underline decoration-accent/40 underline-offset-2 transition-colors hover:decoration-accent"
        >
          {link[1]}
        </a>,
      );
      return;
    }
    part.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).forEach((seg, si) => {
      if (/^\*\*[^*]+\*\*$/.test(seg)) {
        out.push(<strong key={`${pi}-${si}`} className="font-semibold text-white">{seg.slice(2, -2)}</strong>);
      } else if (/^`[^`]+`$/.test(seg)) {
        out.push(
          <code key={`${pi}-${si}`} className="rounded bg-white/[0.08] px-1.5 py-0.5 text-[0.85em] text-white/90">
            {seg.slice(1, -1)}
          </code>,
        );
      } else if (seg) {
        out.push(seg);
      }
    });
  });
  return out;
}

export function Markdown({ blocks }: { blocks: MdBlock[] }) {
  return (
    <div className="space-y-5 text-[15px] leading-relaxed text-white/70">
      {blocks.map((b, i) => {
        switch (b.kind) {
          case "h2":
            return (
              <h2 key={i} className="pt-4 text-xl font-bold tracking-tight text-white">
                {renderInline(b.text)}
              </h2>
            );
          case "h3":
            return (
              <h3 key={i} className="pt-2 text-base font-semibold text-white">
                {renderInline(b.text)}
              </h3>
            );
          case "quote":
            return (
              <blockquote
                key={i}
                className="rounded-xl bg-accent/[0.08] px-4 py-3 text-white/80 ring-1 ring-accent/20"
              >
                {renderInline(b.text)}
              </blockquote>
            );
          case "ul":
            return (
              <ul key={i} className="list-disc space-y-1.5 pl-5">
                {b.items.map((it, j) => (
                  <li key={j}>{renderInline(it)}</li>
                ))}
              </ul>
            );
          case "ol":
            return (
              <ol key={i} className="list-decimal space-y-1.5 pl-5">
                {b.items.map((it, j) => (
                  <li key={j}>{renderInline(it)}</li>
                ))}
              </ol>
            );
          default:
            return <p key={i}>{renderInline(b.text)}</p>;
        }
      })}
    </div>
  );
}
