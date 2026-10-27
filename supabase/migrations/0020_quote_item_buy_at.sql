-- ============================================================================
-- Remus · Handoff 1 (27 Oct 2026): WHERE TO BUY EACH LINE -- the quote's shopping list.
--
-- Stephan: "you find the toilet ... but which unit, which number, which store? ... give me a shopping
-- list, where to go shopping for what, the code ... the particulars of the product" -- and of a line
-- typed by hand: "you don't have to add it, but it would be better to add it. Like, oh, okay, Leroy
-- Merlin has a toilet for [R]20."
--
-- So a material line may carry where it is bought: the store, the store's own product code, the product
-- as the store names it, its page, the price there and the day that price was seen. Filled by "Use" in
-- Find prices, or typed by hand; all optional. INTERNAL: like subcontractor_id, none of it is printed on
-- the client's quote (the PDF reads its own named columns).
--
-- buy_price is kept apart from unit_cost on purpose: the cost is what the quote is priced on and may be
-- rounded or padded; the store price is what the shopping list says to expect at the till.
-- ============================================================================
alter table public.quote_items add column if not exists buy_store text;
alter table public.quote_items add column if not exists buy_code text;
alter table public.quote_items add column if not exists buy_product text;
alter table public.quote_items add column if not exists buy_url text;
alter table public.quote_items add column if not exists buy_price numeric(12, 2) check (buy_price is null or buy_price >= 0);
alter table public.quote_items add column if not exists buy_checked_on date;
