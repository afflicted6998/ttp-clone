# TTP Clone — Instructions for Claude Code

@context/PROJECT_CONTEXT.md
@context/HANDOFF.md

## Working rules for this repo

- **Never push directly to `main`.** All work happens on a branch, opened as a PR. `main` is protected — Steve reviews and merges, not you.
- **Read `context/PROJECT_CONTEXT.md` in full before writing code.** It defines Phase 1 scope explicitly. If a task looks like it needs something listed there as "deferred to Phase 2," stop and open an issue instead of building it.
- **One PR per logical change**, not one giant commit. Small, reviewable diffs — Steve is not a professional developer and needs to be able to follow what changed.
- **You are the sole builder.** Gemini CLI reviews your PRs (invoked by Steve); it does not build. If you develop two genuinely different approaches to the same problem, open both as draft PRs rather than silently picking one — surfaced alternatives are a hard rule in this project (see HANDOFF.md for why).
- **Open a GitHub Issue for anything you're inferring rather than reading directly from `context/`.** Use the issue template. Do not guess silently on anything that would change scope, architecture, or the target device.
- **The target device is a physical Pixel 9 Pro.** Do not design against a simulator or an assumed device.
