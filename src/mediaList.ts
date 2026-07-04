import { supabase } from "./supabase";
import { bucketFor } from "./mediaPath";

export interface MediaItem {
  id: string;
  type: "photo" | "video";
  storage_path: string;
  captured_at: string;
  signedUrl?: string;
}

/**
 * A visit's media rows with 1-hour signed URLs (buckets are private by
 * design; there is no public URL). Shared by the active-visit capture list
 * and the read-only visit detail view.
 */
export async function fetchMediaWithUrls(visitId: string): Promise<MediaItem[]> {
  const { data } = await supabase
    .from("media")
    .select("id, type, storage_path, captured_at")
    .eq("visit_id", visitId)
    .order("captured_at");
  const rows: MediaItem[] = data ?? [];
  await Promise.all(
    rows.map(async (row) => {
      const { data: signed } = await supabase.storage
        .from(bucketFor(row.type))
        .createSignedUrl(row.storage_path, 3600);
      row.signedUrl = signed?.signedUrl;
    }),
  );
  return rows;
}
