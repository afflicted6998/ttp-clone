// Traccar receiver — Supabase Edge Function.
//
// Traccar Client (OsmAnd protocol) fires GET/POST pings at this function's URL.
// Flow: shared-token check → known-device check → map to the active visit →
// insert into location_logs; pings with no active visit go to orphan_pings
// (kept, not discarded — see GitHub issue #2).
//
// Deployed with verify_jwt = false (config.toml): Traccar Client cannot send a
// Supabase JWT, so the shared token in the URL is the auth layer instead.
//
// Secrets (Supabase Edge Function secrets, never the repo):
//   TRACCAR_SHARED_TOKEN — random string; must match the token=... in the URL
//                          configured in Traccar Client.
//   TRACCAR_DEVICE_ID    — the device identifier shown in Traccar Client on the
//                          Pixel; pings from any other id are rejected.

import { createClient } from "npm:@supabase/supabase-js@2";
import { parsePing } from "./ping.ts";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

Deno.serve(async (req: Request) => {
  const url = new URL(req.url);

  // Traccar Client sends params in the query string; some builds POST a form
  // body instead. Merge both, query string winning.
  const params = new URLSearchParams();
  if (req.method === "POST") {
    const contentType = req.headers.get("content-type") ?? "";
    if (contentType.includes("application/x-www-form-urlencoded")) {
      for (const [k, v] of new URLSearchParams(await req.text())) params.set(k, v);
    }
  }
  for (const [k, v] of url.searchParams) params.set(k, v);

  const expectedToken = Deno.env.get("TRACCAR_SHARED_TOKEN");
  if (!expectedToken || params.get("token") !== expectedToken) {
    return new Response("forbidden", { status: 403 });
  }

  const result = parsePing(params);
  if (!result.ok) {
    // 400 = permanently malformed; Traccar re-sending it would never succeed.
    // Log what actually arrived (token stripped) — without this, a client
    // that formats pings unexpectedly is undiagnosable from the dashboard
    // (exactly what happened on first deployment, 2026-07-05).
    const logged = new URLSearchParams(params);
    logged.delete("token");
    console.error(
      `malformed ping: ${result.error} | method=${req.method}`,
      `| content-type=${req.headers.get("content-type") ?? "none"}`,
      `| params=${logged.toString() || "(empty)"}`,
    );
    return new Response(result.error, { status: 400 });
  }
  const ping = result.ping;

  // Required, not optional: a missing secret must fail loudly (500, so
  // Traccar buffers and retries), not silently accept every device
  // (Gemini review of PR #3, finding 2).
  const expectedDevice = Deno.env.get("TRACCAR_DEVICE_ID")?.trim();
  if (!expectedDevice) {
    console.error("TRACCAR_DEVICE_ID secret is not set");
    return new Response("server misconfigured: TRACCAR_DEVICE_ID not set", { status: 500 });
  }
  if (ping.deviceId !== expectedDevice) {
    return new Response("unknown device", { status: 403 });
  }

  // Single-operator Phase 1: the active visit, newest check-in first if there
  // is somehow more than one. nullsFirst: false so a malformed active visit
  // with NULL check_in_time can never outrank a real one (Postgres puts
  // NULLs first on DESC by default).
  const { data: visit, error: visitErr } = await supabase
    .from("visits")
    .select("id")
    .eq("status", "active")
    .order("check_in_time", { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle();

  if (visitErr) {
    // 5xx so Traccar Client keeps the fix buffered and retries.
    console.error("visit lookup failed:", visitErr);
    return new Response("visit lookup failed", { status: 500 });
  }

  // No active visit: before orphaning, check whether this is offline-buffered
  // backfill for a visit that already ended — Traccar can deliver dead-zone
  // points AFTER checkout, and they must land in location_logs so the
  // distance recompute trigger sees them (Gemini PR #9 review, finding 1).
  // Matched by the fix's own recorded_at falling inside a completed visit's
  // check-in/check-out window.
  let targetVisitId = visit?.id ?? null;
  if (!targetVisitId) {
    const { data: past, error: pastErr } = await supabase
      .from("visits")
      .select("id")
      .eq("status", "completed")
      .lte("check_in_time", ping.recordedAt)
      .gte("check_out_time", ping.recordedAt)
      .order("check_out_time", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (pastErr) {
      console.error("late-ping visit lookup failed:", pastErr);
      return new Response("visit lookup failed", { status: 500 });
    }
    targetVisitId = past?.id ?? null;
  }

  if (!targetVisitId) {
    // Genuinely no home for this ping (before check-in / after check-out,
    // outside any visit's window). Keep it — discarding data contradicts the
    // project's whole thesis (issue #2) —
    // but return 200 so Traccar does not retry it forever.
    params.delete("token");
    const { error } = await supabase.from("orphan_pings").insert({
      device_id: ping.deviceId,
      latitude: ping.latitude,
      longitude: ping.longitude,
      recorded_at: ping.recordedAt,
      raw_params: params.toString(),
    });
    if (error) {
      console.error("orphan insert failed:", error);
      return new Response("orphan insert failed", { status: 500 });
    }
    return new Response("ok (no active visit; stored as orphan)", { status: 200 });
  }

  const { error: insertErr } = await supabase.from("location_logs").insert({
    visit_id: targetVisitId,
    coordinate: ping.coordinateWkt,
    latitude: ping.latitude,
    longitude: ping.longitude,
    speed: ping.speedMs,
    battery_level: ping.batteryLevel,
    recorded_at: ping.recordedAt,
    // uploaded_at defaults to NOW(); with buffered offline pings it will lag
    // recorded_at — that difference is what the QA dead-zone scenario checks.
  });
  if (insertErr) {
    console.error("location insert failed:", insertErr);
    return new Response("insert failed", { status: 500 });
  }

  return new Response("ok", { status: 200 });
});
