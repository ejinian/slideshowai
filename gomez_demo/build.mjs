// Inlines the TikTok Sans TTFs as data: URIs so deck.html is one self-contained
// file. Chrome blocks font subresources over file://, so a relative url() would
// silently fall back to system-ui when the deck is opened by double-clicking.
// Photos stay as relative paths — <img>/background-image over file:// is fine.
//
//   node build.mjs      (re-run after editing deck.src.html)

import { readFile, writeFile } from "node:fs/promises";

const dir = new URL("./", import.meta.url);
const b64 = async (f) =>
  `data:font/ttf;base64,${(await readFile(new URL(f, dir))).toString("base64")}`;

const html = (await readFile(new URL("deck.src.html", dir), "utf8"))
  .replace("__FONT700__", await b64("fonts/TikTokSans-700.ttf"))
  .replace("__FONT800__", await b64("fonts/TikTokSans-800.ttf"));

await writeFile(new URL("deck.html", dir), html);
console.log(`deck.html — ${(html.length / 1024).toFixed(0)}KB`);
