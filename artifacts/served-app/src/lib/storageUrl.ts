/**
 * Resolve a stored object key (as returned in fields like `proofPdfUrl`,
 * `proofPhotoUrl`, `signatureImageUrl`) into a fully-qualified, browser-
 * fetchable URL routed through the api-server's `/storage/objects/*` endpoint.
 *
 * Returned URLs are stable: the storage route enforces ACL on every request
 * so we don't need to mint short-lived links for in-app rendering. Useful for
 * <a href> downloads and <img src> previews.
 */
export function resolveStorageObjectUrl(objectKey: string): string {
  const apiBase = `${import.meta.env.BASE_URL.replace(/\/$/, "")}/api`;
  // Already absolute? Return as-is (forward-compat for future presigned links).
  if (/^https?:\/\//i.test(objectKey)) return objectKey;
  // The route is mounted at `/api/storage/objects/*` and the handler
  // re-prepends `/objects/` before looking up the blob. Server-stored
  // paths (e.g. `/objects/uploads/<uuid>` returned by
  // `uploadBufferToObjectStorage`) must therefore have their leading
  // `objects/` segment stripped — otherwise the lookup is for
  // `/objects/objects/uploads/<uuid>` which 404s.
  const trimmed = objectKey.replace(/^\/+/, "").replace(/^objects\//, "");
  return `${apiBase}/storage/objects/${trimmed}`;
}
