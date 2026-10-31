-- ============================================================================
-- Remus · Handover 6 (31 Oct 2026), applied live. Which Unsplash photograph Remus shows where (dashboard band,
-- sign-in, sidebar), chosen by an Administrator on the Photos page; ids from src/lib/brandPhotos.ts. Additive.
-- ============================================================================
alter table public.company_settings add column if not exists brand_photos jsonb not null default '{}'::jsonb;
