# report-card — post-visit report email (Phase 2 gate)

Composes and sends the client report email for one visit: personal note,
photos (7-day signed URLs), stats (duration / distance / weather / terrain),
self-rendered route PNG (inline `cid:route-map` attachment — no map service,
issue #25), per-dog pee/poop yes/no (issue: Steve's per-pet ruling), video
links. Structure mirrors the real TTP report export. Stamps
`visits.report_sent_at` on success and reports `elapsed_ms` — the ≤60s gate
measures itself.

## Auth

`verify_jwt` stays ON (no config.toml entry). The function then re-uses the
caller's JWT to read the visit under their own RLS — you can only send a
report for a visit you can see. Data gathering and URL signing use the
service role.

## Secrets (dashboard → Edge Functions → Secrets)

| name | required | notes |
|---|---|---|
| `RESEND_API_KEY` | yes (for real sends) | resend.com → API Keys |
| `REPORT_TO_EMAIL` | yes (for real sends) | until a domain is verified in Resend, must be the Resend account owner's address |
| `REPORT_FROM_EMAIL` | no | defaults to `Outside Feet <onboarding@resend.dev>` |
| `PWA_BASE_URL` | no | enables the "view the full map in the app" link |

## Invoking

From the PWA (`supabase.functions.invoke`) on checkout, or the "Send report
card" button on a completed visit's detail screen (testing/resend). Manually:

```bash
curl -s -X POST "$SUPABASE_URL/functions/v1/report-card" \
  -H "Authorization: Bearer $USER_JWT" -H "Content-Type: application/json" \
  -d '{"visit_id":"<uuid>"}'
```

`{"visit_id":"…","dry_run":true}` composes everything (map PNG included) but
skips Resend and the `report_sent_at` stamp — full pipeline verification with
no secrets and no email. Response includes `subject`, `html_bytes`,
`map_bytes`, media counts, `gps_points`, `elapsed_ms`.

## Deliberate choices

- **Media failures degrade, never sink**: an unsignable photo is logged and
  skipped; the report still sends.
- **Weather comes from the visit row** (written at checkout by the PWA), not
  re-fetched — the email shows walk-time conditions even if sent hours later.
- **AI care-report narrative is a reserved slot** in the HTML (issue #24:
  deferred until Steve's voice-tuning process). The walker's own
  `visit_notes` carries the story meanwhile.
