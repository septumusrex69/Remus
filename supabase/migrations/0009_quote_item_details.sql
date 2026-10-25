-- A longer write-up under a quote line: the short description says what ("Toilet"), the details
-- say what is included ("Remove old suite, supply and fit close-coupled toilet, connect waste…").
-- Shown on the quote, the print view and the PDF. Numbered 0009 because branch
-- claude/mail-picture-store holds 0008.
alter table public.quote_items add column if not exists details text;
