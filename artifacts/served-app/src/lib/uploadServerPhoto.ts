import { requestServerPhotoUploadUrl } from "@workspace/api-client-react";

/**
 * Upload a server's GPS-stamped proof photo to object storage.
 * Two-step flow: (1) reserve a presigned URL, (2) PUT the file directly to GCS.
 * Returns the persisted objectPath for embedding in attempt/confirm payloads.
 *
 * Field-resilience hardening (servers on cellular may have flaky uplinks):
 *   - Both legs use AbortController-backed timeouts so a stalled connection
 *     fails loudly instead of hanging the mark-served spinner forever.
 *   - The PUT leg auto-retries once on AbortError or 5xx; transient cellular
 *     blips are common and a single retry recovers most of them without
 *     making the server re-do four steps of wizard input.
 */

const REQUEST_URL_TIMEOUT_MS = 20_000; // small JSON call to our API
const PUT_TIMEOUT_MS = 60_000; // file PUT to GCS over potentially-slow LTE
const MAX_PUT_ATTEMPTS = 2; // initial + 1 retry

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
  label: string,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      throw new Error(
        `${label} timed out after ${Math.round(timeoutMs / 1000)}s — check your connection and try again`,
      );
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

export async function uploadServerPhoto(file: File, jobId: number): Promise<string> {
  // Leg 1 — reserve a presigned URL. Fast (small JSON call) but still
  // worth a timeout: we've seen cellular DNS hangs of >2 minutes.
  const reservation = await Promise.race([
    requestServerPhotoUploadUrl({
      jobId,
      contentType: file.type || "image/jpeg",
      size: file.size,
    }),
    new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new Error("Upload reservation timed out — check your connection")),
        REQUEST_URL_TIMEOUT_MS,
      ),
    ),
  ]);
  const { uploadURL, objectPath } = reservation;

  // Leg 2 — PUT the bytes to GCS. Bounded + retried because this is the
  // single most failure-prone step on cellular.
  let lastErr: unknown;
  for (let attempt = 1; attempt <= MAX_PUT_ATTEMPTS; attempt++) {
    try {
      const put = await fetchWithTimeout(
        uploadURL,
        {
          method: "PUT",
          body: file,
          headers: { "Content-Type": file.type || "image/jpeg" },
        },
        PUT_TIMEOUT_MS,
        "Photo upload",
      );
      if (put.ok) return objectPath;
      // 5xx is worth retrying; 4xx is permanent (auth/quota/cors) so bail.
      if (put.status >= 500 && attempt < MAX_PUT_ATTEMPTS) {
        lastErr = new Error(`Photo upload failed (${put.status}) — retrying`);
        continue;
      }
      throw new Error(`Photo upload failed (${put.status})`);
    } catch (err) {
      lastErr = err;
      if (attempt < MAX_PUT_ATTEMPTS) continue;
      throw err;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("Photo upload failed");
}
