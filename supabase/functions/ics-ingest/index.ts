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

  // fetch() rejects (rather than returning !ok) on DNS/connection failures —
  // catch those too, or a Google outage becomes an unhandled crash.
  let feedRes: Response;
  try {
    feedRes = await fetch(feedUrl);
  } catch (e) {
    console.error("feed fetch connection failed:", e);
    return new Response("feed fetch failed: connection error or invalid URL", { status: 502 });
  }
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
  // cancelled_at: null revives an event that was flagged cancelled but has
  // reappeared in the feed (e.g. un-cancelled in Google).
  const { error } = await supabase
    .from("calendar_events")
    .upsert(
      rows.map((r) => ({ ...r, synced_at: syncedAt, cancelled_at: null })),
      { onConflict: "ics_uid" },
    );
  if (error) {
    return new Response(`upsert failed: ${error.message}`, { status: 500 });
  }

  // Soft-cancel sweep: events inside the window that this sync did NOT see
  // (their synced_at is still older) have vanished from the Google feed —
  // cancelled or deleted. Flag them instead of deleting; a visit may already
  // reference them, and check-in filters on cancelled_at IS NULL.
  // Guard: skip the sweep on an empty parse — indistinguishable from a
  // broken/truncated feed, and a later good sync would revive everything
  // anyway; better to never mass-cancel on bad input.
  let cancelled = 0;
  if (rows.length > 0) {
    const { data: swept, error: sweepErr } = await supabase
      .from("calendar_events")
      .update({ cancelled_at: syncedAt })
      .is("cancelled_at", null)
      .lt("synced_at", syncedAt)
      .gte("starts_at", new Date(now - WINDOW_BACK_MS).toISOString())
      .lte("starts_at", new Date(now + WINDOW_FORWARD_MS).toISOString())
      .select("id");
    if (sweepErr) {
      return new Response(`cancel sweep failed: ${sweepErr.message}`, { status: 500 });
    }
    cancelled = swept?.length ?? 0;
  }

  return new Response(
    JSON.stringify({
      ok: true,
      events_in_window: rows.length,
      newly_cancelled: cancelled,
      synced_at: syncedAt,
    }),
    { headers: { "content-type": "application/json" } },
  );
});
