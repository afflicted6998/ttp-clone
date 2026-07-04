# Traccar receiver — deploy & phone setup

What this is: the endpoint Traccar Client on the Pixel sends GPS pings to.
It checks a shared token, maps the ping to the currently active visit, and
inserts a `location_logs` row. Pings with no active visit land in
`orphan_pings` instead of being dropped (issue #2).

## One-time deploy (Steve, ~5 minutes)

1. **Set the two secrets** — Supabase Dashboard → Edge Functions → Secrets:
   - `TRACCAR_SHARED_TOKEN`: a long random string. Generate one however you
     like (a password-manager-generated 30+ character password is fine).
     Store it in the password manager too.
   - `TRACCAR_DEVICE_ID`: the device identifier shown on Traccar Client's
     main screen on the Pixel (Setup Guide, part 3.1, step 3).

2. **Deploy the function** — from the repo root:
   ```
   npx supabase login
   npx supabase link --project-ref <your-project-ref>
   npx supabase functions deploy traccar-receiver
   ```
   (`<your-project-ref>` is in the Supabase dashboard URL:
   `supabase.com/dashboard/project/<this-part>`.)
   JWT verification for this function is already disabled in
   `supabase/config.toml` — Traccar can't send a Supabase login token, the
   shared token in the URL is what protects the endpoint instead.

3. **Point Traccar Client at it** — in the app on the Pixel, set the server
   URL to (one line, no spaces):
   ```
   https://<your-project-ref>.supabase.co/functions/v1/traccar-receiver?token=<TRACCAR_SHARED_TOKEN>
   ```
   Frequency 30 seconds, accuracy High (per the Setup Guide), then toggle
   tracking ON.

## How to tell it's working

- Traccar Client's own status screen shows successful sends (no red errors).
- With a visit checked in (status `active`), rows appear in `location_logs`.
- With **no** active visit, rows appear in `orphan_pings` — that is expected
  behavior, not a bug (it means the walk wasn't checked in).

## Response codes (what Traccar Client does with them)

| Code | When | Traccar's reaction |
|---|---|---|
| 200 | stored (visit or orphan) | drops the fix from its buffer |
| 400 | malformed ping | drops it (re-sending would never succeed) |
| 403 | bad/missing token or unknown device | keeps retrying — fix the URL/secret |
| 500 | database error, or `TRACCAR_DEVICE_ID` secret not set | keeps the fix buffered and retries — nothing is lost |
