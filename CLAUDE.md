# monday-recurrence

Vercel serverless webhook that creates the next occurrence of recurring Work Plan tasks.

## What it does

When monday.com POSTs to `/api/webhook`, the handler:

1. **New recurring parent** — `TASK TYPE` is set to `RECURRENCE` (and there is no Recurrence Parent): create the first child occurrence from Recurrence Start Date + Period, up to End Date.
2. **Child finished** — item has a Recurrence Parent and Status becomes `Done` or `Closed (not done)`: create the next child, or notify the owner if the series has ended.

Column lookup is by **title** (not ID), so it works across duplicated department boards.

## Stack

- Node.js (raw `https` module — no dependencies)
- Vercel serverless function
- monday.com GraphQL API (v2024-10)

## Files

- `api/webhook.js` — single serverless function
- `vercel.json` — Vercel build/route config
- `package.json` — minimal manifest, no dependencies

## Environment variables

- `MONDAY_API_TOKEN` — monday.com API token with write access to all department boards

## Deployment

```bash
npx vercel --prod
```

Webhook URL: `https://monday-recurrence.vercel.app/api/webhook`  
(also aliased as `https://monday-recurrence-zeta.vercel.app/api/webhook`)

## monday.com setup

Per **department** board, three webhooks (Integrate → Webhooks / `create_webhook` API):

1. **When TASK TYPE changes to RECURRENCE** → `change_status_column_value` on `color_mm24wrej`, index `1`
2. **When Status changes to Done** → `change_status_column_value` on that board’s Status column, index `2`
3. **When Status changes to Closed (not done)** → same Status column, index `4`

Status column IDs differ by board (e.g. Technology `color_mm2fyj1b`, Marketing/Projects `color_mm2f56cs`); use each board’s Status column.

## Boards using this app (Workspace: "Work Plan", id 5841490)

All **10** department task boards — Marketing, Projects, and Management included (same setup as the others):

- Full Year (5094162683)
- Technology (5094574505)
- Resources - Israel (5094576859)
- H.R (5094580197)
- Pedagogy (5094581545)
- Resources - USA (5094583693)
- Finance (5094585976)
- Marketing (5100889995)
- Projects (5100890169)
- Management (5102164086)

## Behavior

- Returns `{"challenge": "..."}` for monday.com webhook verification
- Skips when the event is not a recurrence parent or a finished child (200, no error)
- Notifies the Owner when recurrence fields are missing or the series completes
- Child items copy Focus Areas, Objectives, Owner, Managers Partners, Notes, and related fields from the parent
- Sets legacy **Quarter** to `Q1`–`Q4`; when **QuarterYear** exists, also sets `YYYY - Qn`

## Related projects

- `monday-quarter-sync` — Timeline / create-item → Quarter dropdown (legacy + year-quarter endpoints)
- `talma_monday_focus_areas_dashboard` — cross-department Focus Areas UI
