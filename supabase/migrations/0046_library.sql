-- ============================================================================
-- Remus · Handover 8 (7 Nov 2026): THE LIBRARY -- the company's letterhead and its document templates.
--
-- Stephan, 7 Nov, on Raptor's Library: "we can start with pretty much all of that."
--
-- Copied from Raptor's Library (src/pages/library/*, message_templates) and adapted to a builder:
--   * THE LETTERHEAD is not a new table: it is the company's own details already in Settings (company_settings:
--     logo, name, address, phone, email, registration and VAT numbers, banking details), drawn at the head of
--     every document exactly as on a quote. Raptor's letterhead is an uploaded A4 picture with margins; Remus
--     has no such picture, so it uses what the quote PDF already uses.
--   * DOCUMENT TEMPLATES (document_templates): wording with merge fields such as {{client_name}} and
--     {{contract_sum}}, filled in from a project, its client and its quote. Seeded with six builder's documents:
--     a building contract (plain language, JBCC-style, MARKED TO BE CHECKED BY THEIR LAWYER), a site instruction,
--     a variation order, a practical completion certificate, a letter to a client and a payment reminder.
--     Seeded once by seed_key; an edit Stephan makes is never overwritten by a later run.
--   * DOCUMENTS (project_documents): a document made from a template for a project (or a client), with the
--     merge fields already filled in and the words then edited as needed. Kept on the project (its Documents
--     tab). The words are a copy, so changing the template later never changes a document already made.
--
-- WHO: everybody signed in reads the templates; only an Administrator writes them (Raptor: "collectors can't
-- see the library because collectors don't build it" -- in Remus the builders of the library are the office).
-- Documents: anybody who may write makes them. A site manager sees no money (lib/access.ts), so a site
-- manager sees only site instructions, completion certificates and the documents they made themselves --
-- contracts, variations, reminders and letters carry rand amounts.
--
-- Additive only: two new tables, their policies (created only when missing), and seed rows.
-- ============================================================================

create table if not exists public.document_templates (
  id uuid primary key default gen_random_uuid(),
  kind text not null default 'letter'
    check (kind in ('contract', 'site_instruction', 'variation_order', 'completion_certificate', 'letter', 'payment_reminder', 'other')),
  name text not null,
  -- The subject line when the document is emailed (merge fields allowed).
  subject text,
  -- The words, with {{merge_fields}}. A line starting "# " is a heading, "## " a smaller heading, "- " a bullet.
  body text not null default '',
  -- Offered for online signing (a signature block is added at the foot).
  signable boolean not null default false,
  active boolean not null default true,
  -- Set on the rows this migration seeds, so a re-run never duplicates them or overwrites Stephan's edits.
  seed_key text unique,
  created_by uuid references public.profiles (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists document_templates_kind_idx on public.document_templates (kind, name);

comment on table public.document_templates is
  'The Library''s templates (Remus H8, from Raptor''s message_templates): wording with {{merge_fields}} that a document for a project is made from.';

create table if not exists public.project_documents (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references public.projects (id) on delete set null,
  company_id uuid references public.companies (id) on delete set null,
  contact_id uuid references public.contacts (id) on delete set null,
  quote_id uuid references public.quotes (id) on delete set null,
  variation_id uuid references public.variations (id) on delete set null,
  invoice_id uuid references public.invoices (id) on delete set null,
  template_id uuid references public.document_templates (id) on delete set null,
  kind text not null default 'letter'
    check (kind in ('contract', 'site_instruction', 'variation_order', 'completion_certificate', 'letter', 'payment_reminder', 'other')),
  title text not null,
  subject text,
  -- The finished words: merge fields filled in when it was made, then edited by hand.
  body text not null default '',
  signable boolean not null default false,
  status text not null default 'draft' check (status in ('draft', 'sent', 'signed', 'cancelled')),
  sent_at timestamptz,
  sent_to text,
  created_by uuid references public.profiles (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists project_documents_project_idx on public.project_documents (project_id, created_at desc);
create index if not exists project_documents_company_idx on public.project_documents (company_id);
create index if not exists project_documents_contact_idx on public.project_documents (contact_id);
create index if not exists project_documents_quote_idx on public.project_documents (quote_id);
create index if not exists project_documents_variation_idx on public.project_documents (variation_id);
create index if not exists project_documents_invoice_idx on public.project_documents (invoice_id);
create index if not exists project_documents_template_idx on public.project_documents (template_id);
create index if not exists project_documents_created_by_idx on public.project_documents (created_by);
create index if not exists document_templates_created_by_idx on public.document_templates (created_by);

comment on table public.project_documents is
  'Documents made from a Library template for a project or client (Remus H8): the words are a copy, filled in and edited.';

alter table public.document_templates enable row level security;
alter table public.project_documents enable row level security;

do $$
begin
  -- Templates: every active member reads; only an Administrator writes.
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'document_templates' and policyname = 'remus_all') then
    create policy "remus_all" on public.document_templates for all to authenticated
      using ((select public.is_active_member())) with check ((select public.is_active_member()));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'document_templates' and policyname = 'remus_admin_insert') then
    create policy "remus_admin_insert" on public.document_templates as restrictive for insert to authenticated
      with check ((select public.can_write()) and (select public.current_user_role()) = 'Administrator');
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'document_templates' and policyname = 'remus_admin_update') then
    create policy "remus_admin_update" on public.document_templates as restrictive for update to authenticated
      using ((select public.can_write()) and (select public.current_user_role()) = 'Administrator')
      with check ((select public.can_write()) and (select public.current_user_role()) = 'Administrator');
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'document_templates' and policyname = 'remus_admin_delete') then
    create policy "remus_admin_delete" on public.document_templates as restrictive for delete to authenticated
      using ((select public.can_write()) and (select public.current_user_role()) = 'Administrator');
  end if;

  -- Documents: every active member, writes for those who may write, and a site manager sees no money.
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'project_documents' and policyname = 'remus_all') then
    create policy "remus_all" on public.project_documents for all to authenticated
      using ((select public.is_active_member())) with check ((select public.is_active_member()));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'project_documents' and policyname = 'remus_write_insert') then
    create policy "remus_write_insert" on public.project_documents as restrictive for insert to authenticated
      with check ((select public.can_write()));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'project_documents' and policyname = 'remus_write_update') then
    create policy "remus_write_update" on public.project_documents as restrictive for update to authenticated
      using ((select public.can_write())) with check ((select public.can_write()));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'project_documents' and policyname = 'remus_write_delete') then
    create policy "remus_write_delete" on public.project_documents as restrictive for delete to authenticated
      using ((select public.can_write()));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'project_documents' and policyname = 'remus_money_select') then
    create policy "remus_money_select" on public.project_documents as restrictive for select to authenticated
      using ((select public.sees_money_records()) or created_by = (select auth.uid())
             or kind in ('site_instruction', 'completion_certificate'));
  end if;
end $$;

-- ---------------------------------------------------------------------------- the six seeded templates
-- Plain language, to be read by a client who is not a lawyer. The contract says at the top that it must be
-- checked by the company's lawyer before it is used: Remus is not a law firm, and neither is Claude.

insert into public.document_templates (seed_key, kind, name, subject, signable, body) values
('contract-building', 'contract', 'Building contract', 'Building contract: {{project_name}}', true, $t$# BUILDING CONTRACT

NOTE TO THE OFFICE: this is a plain-language starting point in the style of the JBCC Minor Works agreement. Have the company's lawyer check these terms before this contract is used for the first time, and remove this note.

This agreement is made on {{today}} between:

**The contractor:** {{company_name}}, registration number {{company_reg_no}}, VAT number {{company_vat_no}}, of {{company_address}} ("we", "us").

**The client:** {{client_name}}, of {{client_address}} ("you").

## 1. The work
We will carry out the work described in our quotation {{quote_number}} ({{quote_title}}) at {{site_address}} ("the site"). The quotation, with its drawings and specifications, forms part of this contract. Anything not described in it is not included.

## 2. The contract sum
The price for the work is {{contract_sum}} including VAT ({{contract_sum_excl}} excluding VAT). The price only changes through a signed variation order (clause 6).

## 3. Payment
- A deposit of {{deposit_pct}}% ({{deposit_amount}}) is payable when this contract is signed, before we order materials.
- After that we invoice as the work progresses. Each invoice is payable within 7 days.
- The balance is payable on practical completion (clause 8).
- Late payments carry interest at the prime rate plus 2% a year, and we may stop work on 7 days' written notice if an invoice is more than 14 days overdue.

Our banking details:
{{bank_details}}

## 4. Dates
We will start on or about {{start_date}} and aim to reach practical completion by {{end_date}}. These dates move by a fair amount for rain, for delays caused by you or your other contractors, for variations, and for anything outside our control. We will tell you in writing as soon as we know of a delay.

## 5. Your part
- Give us safe access to the site, water and electricity during working hours.
- Obtain the approvals that are the owner's to obtain, including approved building plans where the work needs them, unless our quotation says we will.
- Make decisions and choices (finishes, colours, fittings) in time for the work to continue.

## 6. Changes (variations)
Any change to the work, the price or the time is agreed in writing on a variation order, signed by both of us, before the changed work is done. A variation order states what changes and what it costs.

## 7. Quality, safety and the site
We will do the work in a proper and workmanlike manner, using the materials specified, and in line with the National Building Regulations and the Occupational Health and Safety Act. We keep the site tidy and remove our rubble when the work is finished.

## 8. Practical completion
When the work is complete apart from small items that do not stop you using it, we will ask you to inspect it with us. We then sign a practical completion certificate listing anything still to be finished (the snag list), which we complete within 14 days.

## 9. Defects
For 90 days after practical completion we will fix, at our cost, any defect caused by our workmanship or the materials we supplied. This does not cover fair wear and tear, misuse, or work done by others.

## 10. Insurance and risk
We carry contract works and public liability insurance for the duration of the work. You keep your normal home or building insurance in place. Materials on site belong to you once you have paid for them.

## 11. Ending the contract
Either of us may end this contract if the other does not fix a serious breach within 14 days of written notice. If it ends, you pay for the work done and the materials delivered up to that date.

## 12. Disputes
We will first try to settle any disagreement by meeting in good faith. If that fails within 14 days, either of us may refer it to an independent adjudicator or mediator agreed between us, and then to the courts of South Africa.

## 13. General
This contract, with our quotation, is the whole agreement. Any change to it must be in writing and signed by both of us. Notices go to the addresses above or by email.

Signed for {{company_name}} by {{sender_name}}.$t$),

('site-instruction', 'site_instruction', 'Site instruction', 'Site instruction: {{project_name}}', true, $t$# SITE INSTRUCTION

**Project:** {{project_name}} ({{project_code}})
**Site:** {{site_address}}
**Date:** {{today}}
**Issued by:** {{sender_name}}, {{company_name}}

## Instruction
Describe here exactly what is to be done, where, and by when.

## Effect on price and time
- This instruction does not change the contract sum or the completion date, unless a variation order is issued for it.

Please sign below to confirm that the instruction was received and understood.$t$),

('variation-order', 'variation_order', 'Variation order', 'Variation order: {{project_name}}', true, $t$# VARIATION ORDER

**Project:** {{project_name}} ({{project_code}})
**Site:** {{site_address}}
**Client:** {{client_name}}
**Date:** {{variation_date}}
**Contract / quotation:** {{quote_number}}

## The change
{{variation_description}}

## The cost
- Amount of this variation: {{variation_amount}} excluding VAT ({{variation_amount_incl}} including VAT).
- This amount is added to (or, if it is a reduction, taken off) the contract sum of {{contract_sum}}.

## Time
This variation does not move the completion date, unless stated here.

By signing below, the client agrees to this change and its cost, and asks {{company_name}} to carry it out.$t$),

('completion-certificate', 'completion_certificate', 'Practical completion certificate', 'Practical completion: {{project_name}}', true, $t$# CERTIFICATE OF PRACTICAL COMPLETION

**Project:** {{project_name}} ({{project_code}})
**Site:** {{site_address}}
**Client:** {{client_name}}
**Contractor:** {{company_name}}

We inspected the work together on {{today}}. The work is practically complete: it can be used for its purpose, apart from the small items listed below.

## Items still to be finished (snag list)
-
-
-

{{company_name}} will finish these items within 14 days. The 90-day defects period starts on the date of this certificate. The balance of the contract sum is now due, as set out in the contract.

By signing below, the client confirms the inspection and this list.$t$),

('letter-client', 'letter', 'Letter to client', '{{project_name}}', false, $t${{today}}

{{client_name}}
{{client_address}}

Dear {{client_name}},

**{{project_name}}: {{site_address}}**

Write the letter here.

Kind regards,

{{sender_name}}
{{company_name}}
{{company_phone}} · {{company_email}}$t$),

('payment-reminder', 'payment_reminder', 'Payment reminder', 'Payment reminder: invoice {{invoice_number}}', false, $t${{today}}

{{client_name}}
{{client_address}}

Dear {{client_name}},

**Payment reminder: invoice {{invoice_number}}**

According to our records, invoice {{invoice_number}} of {{invoice_date}} for {{invoice_amount}}, for the work at {{site_address}} ({{project_name}}), was due on {{invoice_due_date}}. The amount still outstanding is {{amount_outstanding}}.

If you have already paid, thank you, and please send us the proof of payment so that we can match it. If not, please pay the outstanding amount within 7 days into:

{{bank_details}}

Please use {{invoice_number}} as the reference. If something on the invoice is not right, or you would like to discuss it, give us a call on {{company_phone}}.

Kind regards,

{{sender_name}}
{{company_name}}$t$)
on conflict (seed_key) do nothing;
