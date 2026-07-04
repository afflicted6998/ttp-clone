import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "./supabase";
import { bucketFor, mediaTypeFor, storagePathFor } from "./mediaPath";

interface Upload {
  key: number;
  file: File;
  label: string;
  status: "uploading" | "done" | "failed";
  error?: string;
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
    // Signed URLs, 1 hour — buckets are private by design.
    for (const row of rows) {
      const { data: signed } = await supabase.storage
        .from(bucketFor(row.type))
        .createSignedUrl(row.storage_path, 3600);
      row.signedUrl = signed?.signedUrl;
    }
    setSaved(rows);
  }, [visitId]);

  useEffect(() => {
    loadSaved();
  }, [loadSaved]);

  function setStatus(key: number, patch: Partial<Upload>) {
    setUploads((u) => u.map((x) => (x.key === key ? { ...x, ...patch } : x)));
  }

  async function upload(key: number, file: File) {
    const type = mediaTypeFor(file.type);
    if (!type) {
      setStatus(key, { status: "failed", error: `unsupported file type: ${file.type}` });
      return;
    }
    setStatus(key, { status: "uploading", error: undefined });
    const path = storagePathFor(visitId, file.type, Date.now());
    // upsert:true makes retries safe if storage succeeded but the row insert failed
    const { error: upErr } = await supabase.storage
      .from(bucketFor(type))
      .upload(path, file, { upsert: true, contentType: file.type });
    if (upErr) {
      setStatus(key, { status: "failed", error: upErr.message });
      return;
    }
    const { error: rowErr } = await supabase.from("media").insert({
      visit_id: visitId,
      type,
      storage_path: path, // path within the bucket; bucket follows from type
    });
    if (rowErr) {
      setStatus(key, { status: "failed", error: `file stored, row failed: ${rowErr.message}` });
      return;
    }
    setStatus(key, { status: "done" });
    loadSaved();
  }

  function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-capturing immediately
    if (!file) return;
    const key = nextKey.current++;
    setUploads((u) => [
      ...u,
      { key, file, label: `${file.type || "file"} · ${Math.round(file.size / 1024)} KB`, status: "uploading" },
    ]);
    upload(key, file);
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
              <a href="#" onClick={(e) => { e.preventDefault(); upload(u.key, u.file); }}>
                retry
              </a>
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
