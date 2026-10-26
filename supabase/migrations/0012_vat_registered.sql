-- Registered for VAT or not (Stephan, 26 Oct 2026: Urban Haus is not registered yet, and it
-- "should be there in the settings").
--
-- Not registered means two things, and both follow from this one switch:
--   * quotes and invoices charge no VAT: new quotes start at 0%, and a quote at 0% shows a plain
--     Total on the PDF, print view and email;
--   * slips and bank expenses are costed at the full amount paid. VAT a supplier charges cannot be
--     claimed back, so it is part of the cost; splitting it out would make every project look
--     about 15% cheaper than it was.
-- vat_rate stays as the rate to use once registered.
alter table public.company_settings add column if not exists vat_registered boolean not null default true;

-- Urban Haus today.
update public.company_settings set vat_registered = false where id = true;
