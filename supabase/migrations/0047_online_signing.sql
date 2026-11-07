-- ============================================================================
-- Remus · Handover 8 (7 Nov 2026): ONLINE SIGNING.
--
-- Stephan, 7 Nov: "Online signing, I'm not sure if that's necessary. But yeah, you can build it, and if other
-- people are going to use it, you can try that."
--
-- Copied from Raptor's signing (signing_requests, src/pages/sign/SignPage.tsx, its signing emails) and adapted:
-- a Library document, a quote or a variation is sent to the client as a link; the client opens it without
-- signing in, reads it, types their name, draws their signature and ticks that they agree. Remus keeps who
-- signed, the picture of the signature, when, from which internet address and browser, and a fingerprint
-- (SHA-256) of the exact words they were shown, and makes a signed PDF with a signature block.
--
-- RAPTOR'S SECURITY CHOICES, KEPT:
--   * The link IS the permission, so it is unguessable: 32 random bytes (256 bits), base64url.
--   * The words are FROZEN when it is sent (body is a copy), so a later edit to the template, document or
--     quote never changes what was signed. For a quote the server also re-reads the quote when it is signed
--     and refuses if it changed since the link went out.
--   * Signed ONCE: the server's update only lands while state = 'sent' and before expires_at.
--   * The anonymous visitor never reads the table: the server (api/portal, service role) answers by token.
-- DIFFERENT FROM RAPTOR, AND WHY:
--   * Only a keyed hash of the token is stored (token_hash), never the token, exactly as the client portal
--     stores its sessions (0026). Someone who could read the table still could not open a link. The office
--     copies the link when it is made; "Send again" makes a new link.
--   * Every link EXPIRES (expires_at is required, 14 days unless the office picks otherwise). Raptor's may be
--     open-ended.
--   * The IP address is recorded (Raptor has the column but its database function cannot see the address;
--     Remus signs through its server, which can).
--   * opened_at / open_count, so the office sees sent / opened / signed.
--
-- A QUOTE SIGNED THIS WAY IS ACCEPTED, like the portal's accept (0042): quotes.accepted_at and accepted_by_name
-- are set and the new quotes.accepted_signing_id points at the signature. accepted_via stays as 0042 allows
-- ('portal' or 'office'), untouched -- widening its check would need the check replaced. A signed variation
-- order marks the variation approved.
--
-- WHO: active members read the requests (a site manager only those they sent, since quotes and variations carry
-- money); every write is the server's (service role), after it checked the person may write.
-- Additive only.
-- ============================================================================

create table if not exists public.signing_requests (
  id uuid primary key default gen_random_uuid(),
  -- HMAC-SHA256 of the token with the server's key (api/_lib/crypto.ts keyedHash('signing', token)).
  token_hash text not null unique,
  -- What is being signed: exactly one of these, or none if it was deleted since.
  source text not null check (source in ('document', 'quote', 'variation')),
  document_id uuid references public.project_documents (id) on delete set null,
  quote_id uuid references public.quotes (id) on delete set null,
  variation_id uuid references public.variations (id) on delete set null,
  project_id uuid references public.projects (id) on delete set null,
  company_id uuid references public.companies (id) on delete set null,
  contact_id uuid references public.contacts (id) on delete set null,
  title text not null,
  -- The words as the signer is shown them, frozen at send time, and their SHA-256.
  body text not null,
  body_hash text not null,
  signer_name text,
  signer_email text,
  state text not null default 'sent' check (state in ('sent', 'signed', 'cancelled')),
  expires_at timestamptz not null default (now() + interval '14 days'),
  opened_at timestamptz,
  open_count integer not null default 0,
  signed_at timestamptz,
  -- What they typed as their name (the identification) and the drawing (the mark), as a PNG data URL.
  signed_name text,
  signature_png text,
  -- The ordinary evidence of an electronic signature (ECTA s13): when, from where, with what.
  signed_ip text,
  signed_agent text,
  -- The fingerprint of the words at the moment of signing; equal to body_hash or it is refused.
  signed_hash text,
  emailed_at timestamptz,
  copy_sent_at timestamptz,
  cancelled_at timestamptz,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists signing_requests_document_idx on public.signing_requests (document_id);
create index if not exists signing_requests_quote_idx on public.signing_requests (quote_id);
create index if not exists signing_requests_variation_idx on public.signing_requests (variation_id);
create index if not exists signing_requests_project_idx on public.signing_requests (project_id, created_at desc);
create index if not exists signing_requests_company_idx on public.signing_requests (company_id);
create index if not exists signing_requests_contact_idx on public.signing_requests (contact_id);
create index if not exists signing_requests_created_by_idx on public.signing_requests (created_by);

comment on table public.signing_requests is
  'A document, quote or variation sent to be signed online (Remus H8, from Raptor). The link''s token is the authority; only its keyed hash is stored. The words are frozen at send time.';

alter table public.signing_requests enable row level security;
revoke all on table public.signing_requests from anon;

do $$
begin
  -- Read only, and only by signed-in members: every write goes through the server (service role).
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'signing_requests' and policyname = 'remus_select') then
    create policy "remus_select" on public.signing_requests for select to authenticated
      using ((select public.is_active_member()));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'signing_requests' and policyname = 'remus_money_select') then
    create policy "remus_money_select" on public.signing_requests as restrictive for select to authenticated
      using ((select public.sees_money_records()) or created_by = (select auth.uid()));
  end if;
end $$;

-- A quote signed online is accepted; this says by which signature (0042's accepted_via is left as it is).
alter table public.quotes
  add column if not exists accepted_signing_id uuid;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'quotes_accepted_signing_fkey') then
    alter table public.quotes
      add constraint quotes_accepted_signing_fkey foreign key (accepted_signing_id)
      references public.signing_requests (id) on delete set null;
  end if;
end $$;
create index if not exists quotes_accepted_signing_idx on public.quotes (accepted_signing_id);
comment on column public.quotes.accepted_signing_id is
  'Set when the client accepted the quote by signing it online (Remus H8): the signing_requests row with their name, signature, time and address.';
