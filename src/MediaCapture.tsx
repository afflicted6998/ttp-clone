import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "./supabase";
import { bucketFor, mediaTypeFor, storagePathFor, type MediaType } from "./mediaPath";

interface Upload {
  key: number;
  file: File;
  label: string;
  status: "uploading" | "done" | "failed";
  error?: string;
  // Fixed at capture time so retries are idempotent: same storage path
  // (re-upload overwrites, never orphans) and same media row id (DB upsert,
  // never duplicates) — Gemini PR #8 review, finding 2.
  type: MediaType;
  path: string;
  mediaId: string;
}

interface MediaRow {
  id: string;
  type: "photo" | "video";
  storage_path: string;
  captured_at: string;
  signedUrl?: string;
}

// QA_TEST_PLAN "media without connectivity": a silent loss is a Major.
// Every capture therefore gets a visible row — uploading / saved / FAILED
// with a retry button — and failed files stay in memory for retry.
export function MediaCapture({ visitId }: { visitId: string }) {
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [saved, setSaved] = useState<MediaRow[]>([]);
  const nextKey = useRef(1);

  const loadSaved = useCallback(async () => {
    const { data } = await supabase
      .from("media")
      .select("id, type, storage_path, captured_at")
      .eq("visit_id", visitId)
      .order("captured_at");
    const rows: MediaRow[] = data ?? [];
    // Signed URLs, 1 hour — buckets are private by design. Fetched
    // concurrently; sequential awaits would stack N round-trips.
    await Promise.all(
      rows.map(async (row) => {
        const { data: signed } = await supabase.storage
          .from(bucketFor(row.type))
          .createSignedUrl(row.storage_path, 3600);
        row.signedUrl = signed?.signedUrl;
      }),
    );
    setSaved(rows);
  }, [visitId]);

  useEffect(() => {
    loadSaved();
  }, [loadSaved]);

  function setStatus(key: number, patch: Partial<Upload>) {
    setUploads((u) => u.map((x) => (x.key === key ? { ...x, ...patch } : x)));
  }

  async function upload(u: Upload) {
    setStatus(u.key, { status: "uploading", error: undefined });
    // upsert:true + the fixed path make storage retries overwrite in place
    // (requires the UPDATE storage policy added in the migration).
    const { error: upErr } = await supabase.storage
      .from(bucketFor(u.type))
      .upload(u.path, u.file, { upsert: true, contentType: u.file.type });
    if (upErr) {
      setStatus(u.key, { status: "failed", error: upErr.message });
      return;
    }
    // Upsert on the client-fixed id: a retry after a lost success response
    // updates the same row instead of inserting a duplicate.
    const { error: rowErr } = await supabase.from("media").upsert({
      id: u.mediaId,
      visit_id: visitId,
      type: u.type,
      storage_path: u.path, // path within the bucket; bucket follows from type
    });
    if (rowErr) {
      setStatus(u.key, { status: "failed", error: `file stored, row failed: ${rowErr.message}` });
      return;
    }
    setStatus(u.key, { status: "done" });
    loadSaved();
  }

  function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-capturing immediately
    if (!file) return;
    const key = nextKey.current++;
    const type = mediaTypeFor(file.type);
    const label = `${file.type || "file"} · ${Math.round(file.size / 1024)} KB`;
    if (!type) {
      setUploads((u) => [
        ...u,
        { key, file, label, status: "failed", error: `unsupported file type: ${file.type}`,
          type: "photo", path: "", mediaId: "" },
      ]);
      return;
    }
    const entry: Upload = {
      key,
      file,
      label,
      status: "uploading",
      type,
      path: storagePathFor(visitId, file.type, Date.now()),
      mediaId: crypto.randomUUID(),
    };
    setUploads((u) => [...u, entry]);
    upload(entry);
  }

  return (
    <div>
      <h3>Media</h3>
      {/* capture= opens the camera directly on Android Chrome */}
      <label>
        Take photo
        <input type="file" accept="image/*" capture="environment" onChange={onPick} />
      </label>
      <label>
        Record video
        <input type="file" accept="video/*" capture="environment" onChange={onPick} />
      </label>

      {uploads.filter((u) => u.status !== "done").map((u) => (
        <p key={u.key} className={u.status === "failed" ? "error" : "muted"}>
          {u.label} — {u.status}
          {u.status === "failed" && (
            <>
              {" "}({u.error}){" "}
              {u.path && (
                <a href="#" onClick={(e) => { e.preventDefault(); upload(u); }}>
                  retry
                </a>
              )}
            </>
          )}
        </p>
      ))}

      {saved.length > 0 && (
        <p className="muted">Saved to your storage: {saved.length} file(s)</p>
      )}
      {saved.map((m) =>
        m.type === "photo" ? (
          <img
            key={m.id}
            src={m.signedUrl}
            alt={`photo ${new Date(m.captured_at).toLocaleTimeString()}`}
            style={{ maxWidth: "100%", borderRadius: 8, marginTop: 8 }}
          />
        ) : (
          <p key={m.id}>
            <a href={m.signedUrl} target="_blank" rel="noreferrer">
              ▶ video {new Date(m.captured_at).toLocaleTimeString()}
            </a>
          </p>
        ),
      )}
    </div>
  );
}
