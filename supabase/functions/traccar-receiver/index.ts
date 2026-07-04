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
    return new Response(result.error, { status: 400 });
  }
  const ping = result.ping;

  const expectedDevice = Deno.env.get("TRACCAR_DEVICE_ID");
  if (expectedDevice && ping.deviceId !== expectedDevice) {
    return new Response("unknown device", { status: 403 });
  }

  // Single-operator Phase 1: the active visit, newest check-in first if there
  // is somehow more than one.
  const { data: visit, error: visitErr } = await supabase
    .from("visits")
    .select("id")
    .eq("status", "active")
    .order("check_in_time", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (visitErr) {
    // 5xx so Traccar Client keeps the fix buffered and retries.
    return new Response("visit lookup failed", { status: 500 });
  }

  if (!visit) {
    // No active visit (before check-in / after check-out). Keep the ping —
    // discarding data contradicts the project's whole thesis (issue #2) —
    // but return 200 so Traccar does not retry it forever.
    params.delete("token");
    const { error } = await supabase.from("orphan_pings").insert({
      device_id: ping.deviceId,
      latitude: ping.latitude,
      longitude: ping.longitude,
      recorded_at: ping.recordedAt,
      raw_params: params.toString(),
    });
    if (error) return new Response("orphan insert failed", { status: 500 });
    return new Response("ok (no active visit; stored as orphan)", { status: 200 });
  }

  const { error: insertErr } = await supabase.from("location_logs").insert({
    visit_id: visit.id,
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
    return new Response("insert failed", { status: 500 });
  }

  return new Response("ok", { status: 200 });
});
