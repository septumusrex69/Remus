-- Scope of work (Stephan, 26 Oct 2026): "right above the line items, there should be a description
-- of the scope of work, just a little bit of a summary". Shown to the client on the quote, the
-- print view and the PDF, above the lines.
alter table public.quotes add column if not exists scope text;
