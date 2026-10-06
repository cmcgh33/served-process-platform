/**
 * Convert a `<canvas>` element to a PNG `File` for upload via the same
 * presigned-URL flow used for proof photos. Used by the affidavit signature
 * capture in the confirm flow + the mark-served modal.
 */
export async function canvasToPngFile(
  canvas: HTMLCanvasElement,
  filename = "signature.png",
): Promise<File> {
  const blob: Blob = await new Promise((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("Canvas is empty"))),
      "image/png",
    );
  });
  return new File([blob], filename, { type: "image/png" });
}
