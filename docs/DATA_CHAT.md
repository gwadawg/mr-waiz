# Data Chat — Mr. Waiz

Scoped, tool-calling assistant inside the dashboard. The user picks a **chat
type** before asking so the model never sees the whole warehouse — and never
sees billing/payroll.

**Owner:** product / call-center ops  
**Status:** live (v2 scopes)  
**KPI truth:** [`docs/KPIS.md`](KPIS.md)

---

## Context model

| Layer | What loads | Where |
|-------|------------|--------|
| Session lock | One scope + date range + optional client | UI → API body |
| Hot policy | Short system prompt + hard exclusions | `prompt.ts` |
| Warm tools | Small allowlisted tool set per scope | `tool-defs.ts` + `tools.ts` |
| Cold evidence | DB / library fetched **only when a tool runs** | metrics, clients, calls, library |

**Rule:** expand by adding a scope or a named tool. Do not widen a tool to “all tables.”

**Hard exclusions (all scopes):** MRR, invoices, Stripe, payroll, expense ledger, billing amounts.

---

## Scopes (v2)

| Scope id | UI label | Tools (summary) |
|----------|----------|-----------------|
| `client_questions` | Client Questions | profile + contacts + fulfillment KPIs + call search/detail |
| `call_rep_questions` | Call Rep Questions | dial analytics + agent scorecards |
| `client_success` | Client Success | profile + KPIs + health snapshot + notes + interventions + playbook search/load |

Permissions are listed in `src/lib/ai/data-chat/scopes.ts` (any-of keys per scope).

---

## Connecting a business knowledge repo (token-safe)

Do **not** paste the other repo into the system prompt.

Best pattern (matches Client Success today):

1. **Curate** high-signal docs (playbooks, SOPs, response frameworks) into Mr. Waiz
   `content/library/` / `library_documents` (or a dedicated knowledge table).
2. **Index** metadata only (title, description, department, slug) — always cheap.
3. **Retrieve on demand** via tools:
   - `search_playbooks(query)` → metadata hits
   - `get_playbook(slug)` → truncated body for that one doc
4. Optional later: embeddings / chunk RAG over the synced library so search is
   semantic; still only inject top-k chunks when the tool runs.

Sync options from an external business repo (e.g. Wm-os):

- CI job / script that copies approved markdown into `content/library`
- Or webhook that upserts `library_documents` rows
- Never auto-ingest billing/payroll folders

Chat SDK / Slack can reuse the same `runDataChat` + scopes later; keep one brain.

---

## CSM Cursor bridge

Deterministic APIs (no LLM) for the sibling **wm-csm-kit**:

- [`docs/CSM_BRIEF_API.md`](CSM_BRIEF_API.md)
- `GET /api/csm/client-brief` — client history + dials/calls/conversions
- `GET /api/csm/team-performance` — team dials + scorecards
- `GET /api/csm/pay-structures` — agent pay rates (not expense/P&L)
- Auth: session **or** user-scoped Bearer (`profiles.csm_api_token_hash`)
- Blocked: MRR, billing, expenses, CEO revenue

The media-buyer kit is a different token and a different route set: [`docs/MB_BRIEF_API.md`](MB_BRIEF_API.md). Do not send that kit to `/api/csm`.

---

## Code map

```
src/lib/ai/data-chat/
  scopes.ts      # registry + permissions + allowlists
  tool-defs.ts   # Anthropic schemas
  tools.ts       # trimmed executors (no billing fields)
  prompt.ts      # runtime policy
  run.ts         # tool loop
  index.ts

src/app/api/ai/data-chat/route.ts
src/components/DataChatPanel.tsx
```

---

## Extending

1. Add scope row in `scopes.ts`.
2. Schemas in `tool-defs.ts`.
3. Executor in `tools.ts` (reuse `src/lib/*`; strip confidential columns).
4. Update this doc.
5. Keep payloads small (snippets / top-N / truncated bodies).
