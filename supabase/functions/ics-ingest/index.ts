// ICS ingestion — Supabase Edge Function.
//
// Fetches Steve's private Google Calendar ICS feed and upserts events into
// calendar_events, so check-in can match a visit to today's appointment.
// Read-only mirror: this function never writes back to Google.
//
// Runs when invoked (scheduling is set up separately — see README.md).
// Keeps the default verify_jwt = true: callers must present a Supabase key,
// so the function URL alone exposes nothing.
//
// Secret (Supabase Edge Function secrets, never the repo):
//   ICS_FEED_URL — the "Secret address in iCal format" from Google Calendar
//                  settings. Treat as a credential: it reads the whole calendar.
//
// Upsert-only by design: events cancelled in Google after ingestion linger in
// calendar_events (they may already be referenced by a visit). Acceptable for
// Phase 1; noted in the PR.

import { createClient } from "npm:@supabase/supabase-js@2";
import { parseCalendar } from "./parse.ts";

// Yesterday → +30 days: enough back-window to keep today's events fresh
// across midnight boundaries, enough forward for the week's schedule.
const WINDOW_BACK_MS = 24 * 60 * 60 * 1000;
const WINDOW_FORWARD_MS = 30 * 24 * 60 * 60 * 1000;

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

Deno.serve(async (_req: Request) => {
  const feedUrl = Deno.env.get("ICS_FEED_URL");
  if (!feedUrl) {
    return new Response("ICS_FEED_URL secret is not set", { status: 500 });
  }

  const feedRes = await fetch(feedUrl);
  if (!feedRes.ok) {
    return new Response(`feed fetch failed: HTTP ${feedRes.status}`, { status: 502 });
  }
  const icsText = await feedRes.text();

  const now = Date.now();
  let rows;
  try {
    rows = parseCalendar(
      icsText,
      new Date(now - WINDOW_BACK_MS),
      new Date(now + WINDOW_FORWARD_MS),
    );
  } catch (e) {
    return new Response(`feed parse failed: ${e instanceof Error ? e.message : e}`, {
      status: 502,
    });
  }

  const syncedAt = new Date(now).toISOString();
  const { error } = await supabase
    .from("calendar_events")
    .upsert(
      rows.map((r) => ({ ...r, synced_at: syncedAt })),
      { onConflict: "ics_uid" },
    );
  if (error) {
    return new Response(`upsert failed: ${error.message}`, { status: 500 });
  }

  return new Response(
    JSON.stringify({ ok: true, events_in_window: rows.length, synced_at: syncedAt }),
    { headers: { "content-type": "application/json" } },
  );
});
