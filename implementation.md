# Implementation backlog

## Audit — 2026-05-12

### Critical

(none — module is functional, no blocker)

### High

- [x] **Bug: "Último contacto" not updating on email send.** Fixed: `handleSent` now always writes `last_contact_at` and calls `setForm` so input refreshes immediately.
- [x] **#5 Cleanup synthetic Andrew Zino smoke-test rows.** SQL provided to Pedro (no code).
- [x] **#1 Sidebar badge — pending FH count.** New `/api/fareharbor/pending-count` route + sidebar useEffect fetches on route change. Red chip with count next to FareHarbor nav.
- [x] **#2 Broader customer-name backfill.** New `/api/admin/backfill-customer-names` POST endpoint. Extracted `extractForwardedSender` + `looksHumanName` to `lib/email-utils.ts` (sync imports from there now).

### Medium

- [x] **#3 Troubleshoot intake — keyword hint.** Sync pre-fetches `liveFhCustomerIds`. Inbound emails from those customers matching the trouble keyword regex get `metadata.fh_troubleshoot_hint = true` + `metadata.fh_troubleshoot_match = <keyword>`. `/emails` list row shows amber 🛠 "troubleshoot?" pill. Does NOT auto-flip status.
- [x] **#7 Extract `<InteractionsTimeline>` shared component.** Done partially. Created `components/interactions-timeline.tsx` with `<InteractionsTimeline>` + `groupTimeline` helper. `fh-integration-detail-client.tsx` now uses it (dropped ~300 LOC of duplicated timeline + InteractionRow). `customer-detail-client.tsx` still has its own richer version (touches 1408-line file deferred for risk).

### Low

- [ ] **#6 Local dev keys.** Pedro task only. Supabase Dashboard → Settings → API → regen `sb_publishable_*` + `sb_secret_*`. Update `.env.local` + Vercel env vars. No code.
- [ ] **#4 FH API real integration.** Deferred until 5+ live partners. Separate phase later.
