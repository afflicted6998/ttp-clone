// Pure helpers mapping a captured file to its bucket / storage path /
// media-row type. Kept free of browser and Supabase imports so they're
// unit-testable with tsx (same pattern as the edge function parsers).

export type MediaType = "photo" | "video";

export function mediaTypeFor(mime: string): MediaType | null {
  if (mime.startsWith("image/")) return "photo";
  if (mime.startsWith("video/")) return "video";
  return null;
}

export function bucketFor(type: MediaType): string {
  return type === "photo" ? "visit-photos" : "visit-video";
}

/** e.g. "<visitId>/1751652000000.jpg"; extension from the MIME subtype. */
export function storagePathFor(visitId: string, mime: string, now: number): string {
  const subtype = mime.split("/")[1] ?? "bin";
  // "video/mp4;codecs=..." → "mp4"; "image/svg+xml" → "svg+xml" → "svg"
  const ext = subtype.split(";")[0].split("+")[0] || "bin";
  return `${visitId}/${now}.${ext}`;
}
