<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## Skills (resolver)

| Task | Load |
|------|------|
| Diagnose one client's ads on proposals, submissions, and fundings (not CPL) | `.cursor/skills/client-ad-diagnosis/SKILL.md` — script in that folder; media-buyer kit uses `GET /api/mb/ad-diagnosis`. Chat only |
| Which client-ad messages are working | `.cursor/skills/ad-performance-learnings/SKILL.md` — scorecard in this repo; learnings file in Wm-os `docs/client-fulfillment/media-buying/performance-learnings.md` |
| Grade a DSCR Meta export: which test ads to graduate, extend, or turn off | `.cursor/skills/dscr-testing-level1/SKILL.md` — Stage 1 only (DSCR-Testing-Level1). Both stages: `docs/CREATIVE_TESTING.md`. Later gates: `docs/AD_TESTING_RULEBOOK.md` |
| Label / name a new Meta ad (Mr. Waiz) | `.cursor/skills/ad-naming/SKILL.md` — lookup via `scripts/ad-name-lookup.ts` (live `ad_library` only) |
| Closebot stale-ticket triage (pre-fix vs still-open) | `docs/superpowers/specs/2026-08-19-closebot-pre-fix-guard-design.md` |
| CSM Cursor brief API (finance-safe client history) | `docs/CSM_BRIEF_API.md` — issue token via `scripts/issue-csm-api-token.ts` |
| Media-buyer brief API (client ads and fulfillment, no company money) | `docs/MB_BRIEF_API.md` — issue token via `scripts/issue-mb-api-token.ts` |
| Client landing builder (DSCR, reverse, HomeSafe) | `docs/superpowers/specs/2026-10-06-client-landing-builder-design.md` — plan: `docs/superpowers/plans/2026-10-07-client-landing-builder.md` |
| UI / design help (21st.dev) | `.cursor/skills/21st-ui-build/SKILL.md` · explore `.cursor/skills/21st-ui-explore/SKILL.md` · review `.cursor/skills/21st-ui-review/SKILL.md` · CLI `.cursor/skills/21st-cli-use/SKILL.md` — design context in `.21st/DESIGN.md` · MCP server `21st` (restart Cursor after setup) |
| Private client offer letters | `offer-letters/README.md` — sheets, tokens, and `offerletter.waizmedia.net` only. Not `public/offers/` |
| Backfill a client's lead list or Meta ads CSV without duplicating stored KPIs | `.cursor/skills/backfill-client-data/SKILL.md` — leads and Meta spend only. Compare, summarize, write after an explicit yes |
