<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## Skills (resolver)

| Task | Load |
|------|------|
| Which client-ad messages are working | `.cursor/skills/ad-performance-learnings/SKILL.md` — scorecard in this repo; learnings file in Wm-os `docs/client-fulfillment/media-buying/performance-learnings.md` |
| Label / name a new Meta ad (Mr. Waiz) | `.cursor/skills/ad-naming/SKILL.md` — lookup via `scripts/ad-name-lookup.ts` (live `ad_library` only) |
| Closebot stale-ticket triage (pre-fix vs still-open) | `docs/superpowers/specs/2026-08-19-closebot-pre-fix-guard-design.md` |
| CSM Cursor brief API (finance-safe client history) | `docs/CSM_BRIEF_API.md` — issue token via `scripts/issue-csm-api-token.ts` |
| Client landing builder (DSCR factory, v1) | `docs/superpowers/specs/2026-10-06-client-landing-builder-design.md` — plan: `docs/superpowers/plans/2026-10-07-client-landing-builder.md` |
| UI / design help (21st.dev) | `.cursor/skills/21st-ui-build/SKILL.md` · explore `.cursor/skills/21st-ui-explore/SKILL.md` · review `.cursor/skills/21st-ui-review/SKILL.md` · CLI `.cursor/skills/21st-cli-use/SKILL.md` — design context in `.21st/DESIGN.md` · MCP server `21st` (restart Cursor after setup) |
| Private client offer letters | `offer-letters/README.md` — sheets, tokens, and `offerletter.waizmedia.net` only. Not `public/offers/` |
