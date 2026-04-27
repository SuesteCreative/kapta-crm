-- ============================================================
-- DROP SCHEDULED EMAILS
-- Schedule-send was rolled back (Vercel Hobby cron limits).
-- Run only if you previously ran 2026-04-27-scheduled-emails.sql.
-- ============================================================
drop table if exists scheduled_emails;
