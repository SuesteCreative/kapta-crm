-- ============================================================
-- Kapta CRM — Enable RLS
-- Run this once in Supabase Dashboard → SQL Editor
-- ============================================================

-- 1. Enable RLS on all tables
ALTER TABLE public.customers           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_identifiers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.interactions         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.follow_ups           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tickets              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.templates            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.companies            ENABLE ROW LEVEL SECURITY;

-- 2. Allow full access for authenticated users (single-tenant CRM)
--    service_role bypasses RLS automatically — no policy needed for server-side ops.
CREATE POLICY "authenticated_full_access" ON public.customers
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "authenticated_full_access" ON public.customer_identifiers
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "authenticated_full_access" ON public.interactions
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "authenticated_full_access" ON public.follow_ups
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "authenticated_full_access" ON public.tickets
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "authenticated_full_access" ON public.templates
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "authenticated_full_access" ON public.companies
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- 3. Fix Function Search Path warnings
ALTER FUNCTION public.update_updated_at() SET search_path = public;

-- resolve_customer may have parameters — run whichever matches your schema:
-- ALTER FUNCTION public.resolve_customer(text) SET search_path = public;
-- ALTER FUNCTION public.resolve_customer(uuid, text) SET search_path = public;
-- (check exact signature in Dashboard → Database → Functions)
