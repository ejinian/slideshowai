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
// integrity check. Retry transient failures with a short backoff.
export async function uploadWithRetry(
  supabaseUrl: string,
  bucket: string,
  storagePath: string,
  body: Buffer,
  contentType: string,
  jwt: string,
  attempts = 3,
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
      await new Promise((r) => setTimeout(r, 300 * 2 ** attempt));
    }
  }
  return { error: `${last.error} (after ${attempts} attempts)` };
}

