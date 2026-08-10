import * as https from "node:https";

// Supabase Storage uploads via Node's native https module.
//
// Extracted from app/api/generate/route.ts so the image-swap endpoint can reuse
// it instead of duplicating the hard-won details below (a second copy would
// inevitably drift from the retry/compression rules that took real debugging to
// find). Server-only — imports node:https.

// Upload a binary buffer to Supabase Storage using Node's native https module,
// bypassing Next.js's patched globalThis.fetch which breaks large binary POSTs.
// agent:false prevents TLS session reuse that causes "bad record mac" errors.
export function rawStorageUpload(
  supabaseUrl: string,
  bucket: string,
  storagePath: string,
  body: Buffer,
  contentType: string,
  jwt: string,
): Promise<{ error?: string; retryable?: boolean }> {
  return new Promise((resolve) => {
    const url = new URL(
      `/storage/v1/object/${bucket}/${storagePath}`,
      supabaseUrl,
    );
    const req = https.request(
      {
        hostname: url.hostname,
        port: url.port ? parseInt(url.port) : 443,
        path: url.pathname,
        method: "POST",
        agent: false,
        headers: {
          Authorization: `Bearer ${jwt}`,
          "Content-Type": contentType,
          "Content-Length": body.length,
          "x-upsert": "true",
        },
      },
      (res) => {
        let raw = "";
        res.on("data", (chunk: Buffer) => (raw += chunk.toString()));
        res.on("end", () => {
          const code = res.statusCode ?? 0;
          if (code >= 200 && code < 300) {
            resolve({});
          } else {
            // 5xx / 429 are worth another go; a 4xx (bad auth, bad path) never
            // will be, so don't burn retries on it.
            const retryable = code >= 500 || code === 429;
            try {
              const parsed = JSON.parse(raw) as { message?: string };
              resolve({ error: parsed.message ?? `HTTP ${code}`, retryable });
            } catch {
              resolve({ error: `HTTP ${code}`, retryable });
            }
          }
        });
      },
    );
    // Transport-level failures (TLS "bad record mac", ECONNRESET, EPIPE) are
    // transient by nature — always retryable.
    req.on("error", (e: Error) => resolve({ error: e.message, retryable: true }));
    req.write(body);
    req.end();
  });
}

// A single flaky socket used to throw away an entire generation — minutes of
// OpenAI + Pexels + compositing work — because one TLS record failed its
// integrity check. Retry transient failures with a backoff.
//
// The schedule is deliberately PATIENT rather than merely repeated. It was 3
// attempts at 300/600ms, which spans under a second of wall clock: `agent:false`
// means every attempt dials a fresh connection, so three failures inside one
// second is usually one blip being sampled three times, not three independent
// chances. Now 5 attempts at 300/600/1200/2400ms — ~4.5s of coverage for the
// same request count order.
//
// Capped at CAP_MS on purpose. Uploads run sequentially per slide inside a route
// budgeted at maxDuration=120, so an uncapped exponential would let one bad
// network moment spend the whole budget in backoff and turn a recoverable
// upload into a hard timeout.
const CAP_MS = 2400;

export async function uploadWithRetry(
  supabaseUrl: string,
  bucket: string,
  storagePath: string,
  body: Buffer,
  contentType: string,
  jwt: string,
  attempts = 5,
): Promise<{ error?: string }> {
  let last: { error?: string; retryable?: boolean } = {};
  for (let attempt = 0; attempt < attempts; attempt++) {
    last = await rawStorageUpload(
      supabaseUrl,
      bucket,
      storagePath,
      body,
      contentType,
      jwt,
    );
    if (!last.error) return {};
    if (!last.retryable) return { error: last.error };
    if (attempt < attempts - 1) {
      // Logged so a CHRONIC problem (VPN, proxy, failing link) is visible as a
      // pattern instead of looking like the same one-off flake every time.
      console.warn(
        `[storage] ${storagePath} attempt ${attempt + 1}/${attempts} failed: ${last.error}`,
      );
      await new Promise((r) =>
        setTimeout(r, Math.min(300 * 2 ** attempt, CAP_MS)),
      );
    }
  }
  return { error: `${last.error} (after ${attempts} attempts)` };
}

