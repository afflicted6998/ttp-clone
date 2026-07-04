# Setup Guide — Everything, In Order

Complete from top to bottom before the first build session. Est. total: 60–90 minutes of your time, nothing has an approval wait. Everything here is free except Claude Code usage (covered by your existing Claude plan) — no Apple account, no device licenses, no paid tiers required for Phase 1.

---

## Part 1 — Accounts & services (~30 min, do from any browser)

### 1.1 GitHub
1. You have an account (assumed — you've been discussing repos). If not: github.com → Sign up.
2. Create repository: **New repository** → name `ttp-clone` → **Private** → do NOT initialize with a README.
3. Upload this project's files: on the empty repo page → **uploading an existing file** link → drag the entire contents of the `ttp-clone` folder (from the zip I gave you) → commit message "Initial project scaffold" → **Commit changes**. This is the one and only direct-to-main commit.
   - ⚠️ GitHub's drag-and-drop can silently skip dotfolders. After uploading, confirm `.github/ISSUE_TEMPLATE/requirement.yml` and `.github/pull_request_template.md` exist in the repo. If they're missing, use **Add file → Create new file**, type the path `\.github/pull_request_template.md` manually, and paste contents.
4. Protect main: **Settings → Branches → Add branch protection rule** → pattern `main` → check **Require a pull request before merging** → check **Require approvals** (1) → leave force-push/deletion OFF → Save.

### 1.2 Supabase
1. supabase.com → sign in → **New project** → name `outside-feet-data` → region: East US (closest to DC) → generate a strong DB password and store it in your password manager.
2. Once provisioned: **Database → Extensions** → search `postgis` → enable.
3. **SQL Editor** → New query → paste the full contents of `context/DATA_MODEL.sql` from the repo → Run. Confirm zero errors and four tables appear under **Table Editor** (calendar_events, visits, location_logs, media).
4. **Storage** → create bucket `visit-photos` (private) → create bucket `visit-video` (private).
5. Collect and store these (Settings → API): **Project URL**, **anon key**, **service_role key**. The service_role key is a full-access credential — password manager, never the repo, never the PWA code.

### 1.3 Google Calendar ICS feed
1. Google Calendar (desktop web) → hover your walk calendar in the left sidebar → ⋮ → **Settings and sharing**.
2. Scroll to **Integrate calendar** → copy **Secret address in iCal format** (ends `.ics`).
3. This URL is a credential — anyone holding it reads your whole calendar. Password manager only.
4. Known limitation, accept it now: Google serves this feed with a lag (can be hours). Same-morning schedule changes may not appear by check-in. Fine for Phase 1.

### 1.4 Vercel (hosts the PWA)
1. vercel.com → **Sign up with GitHub** (this is the whole integration — no separate config).
2. That's it for now. After Claude Code's first PWA PR merges, you'll click **Add New → Project → import `ttp-clone`** and Vercel auto-deploys `main` on every merge. Free Hobby tier is sufficient.

---

## Part 2 — Software on your computer (~20 min)

Order matters — later items depend on earlier ones.

### 2.1 Node.js 22 LTS
- nodejs.org → download LTS → install with defaults.
- Verify in a terminal: `node --version` (v22.x) and `npm --version`.

### 2.2 Git + GitHub CLI
- git-scm.com → install (defaults fine).
- cli.github.com → install **gh**.
- Authenticate once: `gh auth login` → GitHub.com → HTTPS → login via browser. This one credential serves you, Claude Code, and Gemini CLI — nothing else needs GitHub tokens.

### 2.3 Claude Code
```
npm install -g @anthropic-ai/claude-code
```
- Verify: `claude --version`. First run will walk you through authenticating with your existing Claude account.

### 2.4 Gemini CLI + code-review extension
```
npm install -g @google/gemini-cli
gemini extensions install https://github.com/gemini-cli-extensions/code-review
```
- Verify: `gemini --version`. First run authenticates with your Google account.
- Why not the Gemini Code Assist GitHub app: its consumer version shuts down July 17, 2026 — two weeks out — and the surviving enterprise version requires Google Cloud + Developer Connect infrastructure we deliberately cut. Gemini CLI gives the same QC role with zero new infrastructure.

### 2.5 Clone the repo
```
git clone https://github.com/<your-username>/ttp-clone.git
cd ttp-clone
```

---

## Part 3 — Phone (Pixel 9 Pro, ~10 min)

### 3.1 Traccar Client
1. Play Store → **Traccar Client** (publisher: Traccar) → install.
2. Open it once; grant location permission as **Allow all the time** (background access — this is the entire point).
3. Note the **device identifier** it shows — you'll need it when configuring the edge function.
4. Leave **server URL** blank for now — it gets set to your Supabase edge function URL once Claude Code builds and deploys that function (the deploy PR will contain the exact URL to paste in).
5. Settings to confirm in-app when you configure it: frequency 30s to start; location accuracy High.

### 3.2 The PWA
Nothing to install — once deployed, you'll open the Vercel URL in Chrome on the Pixel and use **Add to Home Screen**. Camera capture works from the browser.

---

## Part 4 — Secrets wiring (~5 min, after Parts 1–2)

Supabase Edge Functions read secrets from the project's secret store, not the repo.
Dashboard → **Edge Functions → Secrets** (or `supabase secrets set` via CLI once Claude Code sets that up) — you will add:
- `ICS_FEED_URL` — the secret calendar address from 1.3
- Traccar's shared token (Claude Code will define this when building the receiver — it prevents random internet traffic from writing GPS points into your database)

The repo must only ever contain a `.env.example` with placeholder names. If a real key ever lands in a commit, treat it as burned: rotate it in Supabase immediately — deleting the commit is not enough.

---

## Part 5 — First session (how the work actually starts)

```
cd ttp-clone
claude
```
Claude Code auto-loads `CLAUDE.md` → `context/PROJECT_CONTEXT.md` and `context/HANDOFF.md`. Your first instruction can be as simple as:

> Read the handoff document and confirm your understanding of Phase 1 scope, then propose the first PR.

When a PR goes up, review flow is:
1. `cd ttp-clone && gemini` → ask it to review the PR (the code-review extension handles fetching the diff via gh).
2. Read Gemini's findings yourself — you're the arbiter, not a relay.
3. Tell Claude Code which findings to address, e.g. "address findings 2 and 4, skip 1 with a comment explaining why."
4. Merge on GitHub when satisfied. Vercel redeploys automatically.

## Cost summary
| Item | Cost |
|---|---|
| GitHub private repo, Supabase free tier, Vercel Hobby, Traccar Client, Gemini CLI | $0 |
| Claude Code | your existing Claude plan |
| TransistorSoft license | **$0 — no longer used** (architecture change) |
| Apple Developer | **$0 — not needed for Phase 1** (no iOS, no native builds) |
