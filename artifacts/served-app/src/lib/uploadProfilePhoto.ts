import { requestProfilePhotoUploadUrl } from "@workspace/api-client-react";

/**
 * Upload a server's profile headshot to object storage.
 * Two-step flow: (1) reserve a presigned URL (no job binding), (2) PUT the file
 * directly to GCS. Returns the persisted objectPath, saved via
 * PATCH /me/server-profile { photoUrl }.
 *
 * Mirrors uploadServerPhoto's field-resilience hardening (bounded timeouts +
 * one retry on transient 5xx/abort) since servers may be on flaky connections.
 */

const REQUEST_URL_TIMEOUT_MS = 20_000;
const PUT_TIMEOUT_MS = 60_000;
const MAX_PUT_ATTEMPTS = 2;

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

export async function uploadProfilePhoto(file: File): Promise<string> {
  const reservation = await Promise.race([
    requestProfilePhotoUploadUrl({
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
