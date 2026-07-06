// Report-card sender — Supabase Edge Function (Phase 2 gate).
//
// POST { visit_id, dry_run? } with the caller's Supabase JWT (verify_jwt is
// ON — default). Flow: caller's own RLS proves they may see the visit →
// service role gathers points/media + signs URLs → route PNG rendered
// in-process (no map service) → HTML built → sent via Resend → visits
// .report_sent_at stamped. Returns elapsed_ms so the ≤60s gate is measured
// by the system itself, not a stopwatch.
//
// dry_run: true composes everything (including the PNG) but skips Resend and
// the report_sent_at stamp — lets the pipeline be verified end-to-end before
// the Resend secrets exist, and costs nothing to keep.
//
// Secrets (Supabase Edge Function secrets, never the repo):
//   RESEND_API_KEY    — from resend.com (issue #24, option B ruling)
//   REPORT_TO_EMAIL   — the test inbox. Until a sending domain is verified in
//                       Resend, this MUST be the Resend account owner's email.
//   REPORT_FROM_EMAIL — optional; defaults to Resend's sandbox sender.
//   PWA_BASE_URL      — optional; enables the "view in app" link.

import { createClient } from "npm:@supabase/supabase-js@2";
import { splitDogLabel } from "../_shared/dogLabel.ts";
import { renderRoutePng } from "../_shared/routePng.ts";
import { buildReportEmail, type ReportData } from "../_shared/reportEmail.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const service = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

const SIGNED_URL_TTL_S = 7 * 24 * 3600; // clients read the email for days, not minutes

function b64(bytes: Uint8Array): string {
  let s = "";
  const CHUNK = 0x8000; // String.fromCharCode arg-count limit
  for (let i = 0; i < bytes.length; i += CHUNK) {
    s += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(s);
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  const started = Date.now();
  if (req.method !== "POST") return json(405, { error: "POST only" });

  let visitId: string;
  let dryRun: boolean;
  try {
    const body = await req.json();
    visitId = String(body.visit_id ?? "");
    dryRun = body.dry_run === true;
  } catch {
    return json(400, { error: "JSON body { visit_id } required" });
  }
  if (!/^[0-9a-f-]{36}$/i.test(visitId)) return json(400, { error: "visit_id must be a UUID" });

  // Authorization = the caller's own RLS view of the visit. If their JWT
  // can't see the row, they don't get a report of it. (verify_jwt already
  // rejected requests with no valid JWT before we got here.)
  const callerJwt = req.headers.get("authorization") ?? "";
  const caller = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: callerJwt } },
  });
  const { data: visit, error: visitErr } = await caller
    .from("visits")
    .select(
      "id, dog_label, terrain_tag, visit_notes, check_in_time, check_out_time, duration_minutes, distance_meters, pee_dogs, poop_dogs, weather_temp_c, weather_code, weather_wind_kmh, report_sent_at, calendar_events(title)",
    )
    .eq("id", visitId)
    .maybeSingle();
  if (visitErr) return json(500, { error: `visit lookup: ${visitErr.message}` });
  if (!visit) return json(404, { error: "visit not found (or not yours)" });

  // Gather with the service role: GPS trail + media, signing storage URLs.
  const [logsRes, mediaRes, junctionRes] = await Promise.all([
    service
      .from("location_logs")
      .select("latitude, longitude")
      .eq("visit_id", visitId)
      .order("recorded_at"),
    service
      .from("media")
      .select("type, storage_path, captured_at")
      .eq("visit_id", visitId)
      .order("captured_at"),
    service
      .from("visit_dogs")
      .select("peed, pooped, dogs(name)")
      .eq("visit_id", visitId),
  ]);
  if (logsRes.error) return json(500, { error: `location_logs: ${logsRes.error.message}` });
  if (mediaRes.error) return json(500, { error: `media: ${mediaRes.error.message}` });

  // Registered dogs (visit_dogs junction) are authoritative when present;
  // the dog_label + name-array bridge covers everything older or ad-hoc.
  const junction = (junctionRes.data ?? []).map((r) => ({
    name: (r.dogs as unknown as { name: string } | null)?.name ?? "?",
    peed: Boolean(r.peed),
    pooped: Boolean(r.pooped),
  }));

  const points = (logsRes.data ?? []).map((p) => ({
    latitude: Number(p.latitude),
    longitude: Number(p.longitude),
  }));

  const photoUrls: string[] = [];
  const videos: { url: string; capturedAt: string }[] = [];
  for (const m of mediaRes.data ?? []) {
    const bucket = m.type === "photo" ? "visit-photos" : "visit-video";
    const { data: signed, error: signErr } = await service.storage
      .from(bucket)
      .createSignedUrl(m.storage_path, SIGNED_URL_TTL_S);
    if (signErr || !signed) {
      console.error(`sign failed for ${bucket}/${m.storage_path}: ${signErr?.message}`);
      continue; // a missing thumbnail must not sink the report
    }
    if (m.type === "photo") photoUrls.push(signed.signedUrl);
    else videos.push({ url: signed.signedUrl, capturedAt: m.captured_at });
  }

  const mapPng = points.length > 0 ? await renderRoutePng(points) : null;

  const data: ReportData = {
    dogs: junction.length > 0 ? junction.map((j) => j.name) : splitDogLabel(visit.dog_label),
    peeDogs:
      junction.length > 0
        ? junction.filter((j) => j.peed).map((j) => j.name)
        : visit.pee_dogs ?? [],
    poopDogs:
      junction.length > 0
        ? junction.filter((j) => j.pooped).map((j) => j.name)
        : visit.poop_dogs ?? [],
    visitNotes: visit.visit_notes,
    terrain: visit.terrain_tag,
    checkInIso: visit.check_in_time,
    checkOutIso: visit.check_out_time,
    durationMinutes: visit.duration_minutes,
    distanceMeters: visit.distance_meters === null ? null : Number(visit.distance_meters),
    weather:
      visit.weather_temp_c !== null && visit.weather_code !== null
        ? {
            tempC: Number(visit.weather_temp_c),
            code: visit.weather_code,
            windKmh: Number(visit.weather_wind_kmh ?? 0),
          }
        : null,
    photoUrls,
    videos,
    appointmentTitle: (visit.calendar_events as { title: string | null } | null)?.title ?? null,
    hasMap: mapPng !== null,
    appUrl: Deno.env.get("PWA_BASE_URL") ?? null,
  };
  const { subject, html } = buildReportEmail(data);

  if (dryRun) {
    return json(200, {
      ok: true,
      dry_run: true,
      subject,
      html_bytes: html.length,
      map_bytes: mapPng?.length ?? 0,
      photos: photoUrls.length,
      videos: videos.length,
      gps_points: points.length,
      elapsed_ms: Date.now() - started,
    });
  }

  const apiKey = Deno.env.get("RESEND_API_KEY");
  const toEmail = Deno.env.get("REPORT_TO_EMAIL");
  if (!apiKey || !toEmail) {
    return json(500, {
      error:
        "RESEND_API_KEY / REPORT_TO_EMAIL secrets not configured — see supabase/functions/report-card/README.md (or call with dry_run: true)",
    });
  }

  const sendRes = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
    body: JSON.stringify({
      from: Deno.env.get("REPORT_FROM_EMAIL") ?? "Outside Feet <onboarding@resend.dev>",
      to: [toEmail],
      subject,
      html,
      attachments: mapPng
        ? [{ filename: "route.png", content: b64(mapPng), content_id: "route-map" }]
        : undefined,
    }),
  });
  const sendBody = await sendRes.text();
  if (!sendRes.ok) {
    console.error(`resend ${sendRes.status}: ${sendBody.slice(0, 500)}`);
    return json(502, { error: `resend rejected the send (${sendRes.status})` });
  }

  const sentAt = new Date().toISOString();
  const { error: stampErr } = await service
    .from("visits")
    .update({ report_sent_at: sentAt, updated_at: sentAt })
    .eq("id", visitId);
  if (stampErr) console.error(`report_sent_at stamp failed: ${stampErr.message}`);

  return json(200, {
    ok: true,
    resend_id: (() => {
      try {
        return JSON.parse(sendBody).id ?? null;
      } catch {
        return null;
      }
    })(),
    elapsed_ms: Date.now() - started,
  });
});
