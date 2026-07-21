import { mkdir, writeFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

// Local-only forensic dump for a single generation run. Every run writes an
// entire folder under <repo>/diagnostics so a bad slideshow can be diagnosed
// after the fact WITHOUT screenshots: the exact prompts sent to each model, each
// model's raw response, the per-slide image decisions, and the actual images
// used (numbered to match the slides and the LLM's own indices).
//
//   diagnostics/Run_3_Diagnostics/          <- uploads (image-first) run
//   diagnostics/Run_4_Diagnostics_Stock/    <- stock (live Pexels) run
//
// Disabled in production (Vercel's FS is read-only and we never want prod I/O).

// Anchor dumps to THIS REPO's root — the nearest ancestor with a package.json —
// so they always land in <repo>/diagnostics, never in whatever cwd the dev
// server happened to start from. Falls back to cwd if no package.json is found.
function repoRoot(): string {
  let dir = process.cwd();
  for (let i = 0; i < 8; i++) {
    if (existsSync(path.join(dir, "package.json"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return process.cwd();
}

export interface RunLogger {
  dir: string;
  json(name: string, data: unknown): Promise<void>;
  text(name: string, body: string): Promise<void>;
  image(relName: string, buf: Buffer): Promise<void>;
  /** Collected notes, rendered into 00_SUMMARY.md by finish(). */
  add(section: string, body: string): void;
  finish(): Promise<void>;
}

function ext(buf: Buffer): string {
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8) return "jpg";
  if (buf.length > 8 && buf[0] === 0x89 && buf[1] === 0x50) return "png";
  return "bin";
}

export async function createRun(
  kind: "upload" | "stock",
): Promise<RunLogger | null> {
  // LOCAL DEV ONLY. Never on Vercel: its FS is read-only apart from /tmp, so
  // dumps would either throw or pile up as ghost folders in the serverless
  // sandbox. Both guards matter — VERCEL is set even if someone runs `next dev`
  // on a Vercel machine.
  if (process.env.NODE_ENV !== "development") return null;
  if (process.env.VERCEL || process.env.VERCEL_ENV) return null;
  const ROOT = path.join(repoRoot(), "diagnostics");
  try {
    await mkdir(ROOT, { recursive: true });
    const existing = await readdir(ROOT).catch(() => [] as string[]);
    // Number runs chronologically across BOTH kinds so ordering is unambiguous.
    const nums = existing
      .map((d) => /^Run_(\d+)_Diagnostics/.exec(d)?.[1])
      .filter((n): n is string => Boolean(n))
      .map(Number);
    const n = (nums.length ? Math.max(...nums) : 0) + 1;
    const dir = path.join(
      ROOT,
      `Run_${n}_Diagnostics${kind === "stock" ? "_Stock" : ""}`,
    );
    await mkdir(path.join(dir, "images"), { recursive: true });
    if (kind === "upload") {
      await mkdir(path.join(dir, "uploads"), { recursive: true });
    }

    const sections: string[] = [];
    return {
      dir,
      async json(name, data) {
        await writeFile(
          path.join(dir, name),
          JSON.stringify(data, null, 2),
          "utf8",
        ).catch(() => {});
      },
      async text(name, body) {
        await writeFile(path.join(dir, name), body, "utf8").catch(() => {});
      },
      async image(relName, buf) {
        await writeFile(path.join(dir, `${relName}.${ext(buf)}`), buf).catch(
          () => {},
        );
      },
      add(section, body) {
        sections.push(`## ${section}\n\n${body}\n`);
      },
      async finish() {
        await writeFile(
          path.join(dir, "00_SUMMARY.md"),
          `# Generation run — ${kind === "stock" ? "Stock photos" : "Uploads"}\n\n${sections.join("\n")}`,
          "utf8",
        ).catch(() => {});
      },
    };
  } catch {
    return null;
  }
}
