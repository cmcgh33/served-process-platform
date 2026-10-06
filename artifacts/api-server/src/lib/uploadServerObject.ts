/**
 * Server-side blob upload helper. Used by flows that need to write a
 * generated artifact (e.g. an affidavit PDF) directly to private object
 * storage without going through the presigned-URL round-trip the browser
 * uses. Returns the persisted object path (e.g. `/objects/uploads/<uuid>`)
 * suitable for storing on a job row and serving via `/api/storage/objects/*`.
 */
import { ObjectStorageService } from "./objectStorage";

const objectStorage = new ObjectStorageService();

export async function uploadBufferToObjectStorage(
  buffer: Buffer,
  contentType: string,
): Promise<string> {
  const uploadURL = await objectStorage.getObjectEntityUploadURL();
  const objectPath = objectStorage.normalizeObjectEntityPath(uploadURL);

  const put = await fetch(uploadURL, {
    method: "PUT",
    body: new Uint8Array(buffer),
    headers: { "Content-Type": contentType },
  });
  if (!put.ok) {
    const txt = await put.text().catch(() => "");
    throw new Error(
      `Object storage upload failed (${put.status}): ${txt.slice(0, 200)}`,
    );
  }

  return objectPath;
}

/**
 * Fetch a private object's bytes via the sidecar — used when generating a
 * derivative artifact (e.g. embedding a captured signature image into a
 * generated PDF). Returns `null` and logs nothing if the object is missing
 * so callers can degrade gracefully.
 */
export async function downloadObjectBytes(
  objectPath: string,
): Promise<Buffer | null> {
  try {
    const file = await objectStorage.getObjectEntityFile(objectPath);
    const [bytes] = await file.download();
    return bytes;
  } catch {
    return null;
  }
}
