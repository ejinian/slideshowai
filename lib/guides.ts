import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

// SERVER-ONLY guide loader. Guides are plain markdown files in content/guides
// (frontmatter + a constrained md subset) rendered fully static at build time —
// adding guide #7 is "drop a .md file, done". The ## FAQ section is parsed out
// so guide pages can emit FAQPage JSON-LD for rich search results.

const GUIDES_DIR = path.join(process.cwd(), "content", "guides");

export interface GuideMeta {
  slug: string;
  title: string;
  description: string;
  minutes: number;
}

export interface FaqItem {
  question: string;
  answer: string;
}

/** Constrained markdown block model (see renderer in components/landing/Markdown.tsx). */
export type MdBlock =
  | { kind: "h2"; text: string }
  | { kind: "h3"; text: string }
  | { kind: "p"; text: string }
  | { kind: "ul"; items: string[] }
  | { kind: "ol"; items: string[] }
  | { kind: "quote"; text: string };

export interface Guide extends GuideMeta {
  blocks: MdBlock[];
  faq: FaqItem[];
}

function parseFrontmatter(raw: string): { meta: Record<string, string>; body: string } {
  const m = raw.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!m) return { meta: {}, body: raw };
  const meta: Record<string, string> = {};
  for (const line of m[1].split("\n")) {
    const i = line.indexOf(":");
    if (i > 0) meta[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return { meta, body: raw.slice(m[0].length) };
}

function parseBlocks(body: string): MdBlock[] {
  const blocks: MdBlock[] = [];
  const lines = body.split("\n");
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }
    if (line.startsWith("## ")) { blocks.push({ kind: "h2", text: line.slice(3).trim() }); i++; continue; }
    if (line.startsWith("### ")) { blocks.push({ kind: "h3", text: line.slice(4).trim() }); i++; continue; }
    if (line.startsWith("> ")) { blocks.push({ kind: "quote", text: line.slice(2).trim() }); i++; continue; }
    if (/^[-*] /.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^[-*] /.test(lines[i])) { items.push(lines[i].replace(/^[-*] /, "").trim()); i++; }
      blocks.push({ kind: "ul", items });
      continue;
    }
    if (/^\d+\. /.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\d+\. /.test(lines[i])) { items.push(lines[i].replace(/^\d+\. /, "").trim()); i++; }
      blocks.push({ kind: "ol", items });
      continue;
    }
    // paragraph: greedy until blank line or a block starter
    const para: string[] = [line.trim()];
    i++;
    while (
      i < lines.length &&
      lines[i].trim() &&
      !/^(## |### |> |[-*] |\d+\. )/.test(lines[i])
    ) { para.push(lines[i].trim()); i++; }
    blocks.push({ kind: "p", text: para.join(" ") });
  }
  return blocks;
}

/** Split the trailing "## FAQ" section into q/a pairs; strips it from blocks. */
function extractFaq(blocks: MdBlock[]): { blocks: MdBlock[]; faq: FaqItem[] } {
  const faqStart = blocks.findIndex((b) => b.kind === "h2" && /^faq$/i.test(b.text));
  if (faqStart === -1) return { blocks, faq: [] };
  const faq: FaqItem[] = [];
  let current: FaqItem | null = null;
  for (const b of blocks.slice(faqStart + 1)) {
    if (b.kind === "h3") {
      if (current) faq.push(current);
      current = { question: b.text, answer: "" };
    } else if (current && b.kind === "p") {
      current.answer = current.answer ? `${current.answer} ${b.text}` : b.text;
    }
  }
  if (current) faq.push(current);
  return { blocks: blocks.slice(0, faqStart), faq };
}

export function listGuides(): GuideMeta[] {
  return readdirSync(GUIDES_DIR)
    .filter((f) => f.endsWith(".md"))
    .map((f) => {
      const { meta } = parseFrontmatter(readFileSync(path.join(GUIDES_DIR, f), "utf8"));
      return {
        slug: f.replace(/\.md$/, ""),
        title: meta.title ?? f,
        description: meta.description ?? "",
        minutes: Number(meta.minutes) || 5,
      };
    })
    .sort((a, b) => (Number(a.minutes) || 0) - (Number(b.minutes) || 0));
}

export function getGuide(slug: string): Guide | null {
  if (!/^[a-z0-9-]+$/.test(slug)) return null;
  try {
    const raw = readFileSync(path.join(GUIDES_DIR, `${slug}.md`), "utf8");
    const { meta, body } = parseFrontmatter(raw);
    const { blocks, faq } = extractFaq(parseBlocks(body));
    return {
      slug,
      title: meta.title ?? slug,
      description: meta.description ?? "",
      minutes: Number(meta.minutes) || 5,
      blocks,
      faq,
    };
  } catch {
    return null;
  }
}
