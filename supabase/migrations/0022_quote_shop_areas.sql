-- ============================================================================
-- Remus · Handoff 1 (27 Oct 2026): WHERE A QUOTE SHOPS.
--
-- Stephan: "where you're looking and what's the radius ... unless you include delivery, because delivery
-- can come from anywhere" -- and that it is "quotation specific ... where you're looking for stuff".
-- So each quote keeps its own search areas: [{ label, address, radiusKm }] (the site first, then any
-- others, e.g. 5 km around Brooklyn where the preferred store is), and whether stores outside them may
-- still be searched because they deliver. Find prices on the quote reads these; the map draws them.
-- ============================================================================
alter table public.quotes add column if not exists shop_areas jsonb not null default '[]'::jsonb check (jsonb_typeof(shop_areas) = 'array');
alter table public.quotes add column if not exists shop_online boolean not null default true;
