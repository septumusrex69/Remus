-- ============================================================================
-- Remus · Handover 6 (31 Oct 2026): THE PRODUCTS BOOK. Applied live.
-- Stephan: paint stripper -- two kinds bought, used for a week, then two more "far superior to the other ones".
-- "We should save the products that we used ... warn ourselves against buying ... It was a shit product. Don't buy
-- this ... if I ... mark it as my preferential product ... recommend this ... to other builders."
--
-- Step 1 (now): Urban Haus's own book. A product, the team's verdict on it (preferred / fine / avoid), a rating,
-- what it is good for, a note, where it was bought and for how much; and every time it was used (product_uses):
-- which job, which slip or quote line, the price then, a note. Quotes, Find prices and Snap slip read it to warn
-- and to suggest.
-- Step 2 (later, with multi-company): `share_ok` is the company's yes to pooling its verdicts with other builders,
-- anonymously; nothing reads it yet.
-- Additive only.
-- ============================================================================
create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) > 0),
  brand text,
  -- What kind of thing it is, in the team's words: "Paint stripper", "Cement", "Tile adhesive".
  category text,
  -- What it is good (or useless) for: "stripping paint off floors".
  use_for text,
  unit text,
  store text,
  product_code text,
  product_url text,
  last_price numeric(14,2),
  verdict text not null default 'ok' check (verdict in ('preferred', 'ok', 'avoid')),
  rating smallint check (rating between 1 and 5),
  note text,
  share_ok boolean not null default false,
  -- Lower-case words of the name and brand, for matching a slip line or a quote line to the book.
  match_key text generated always as (lower(regexp_replace(coalesce(brand, '') || ' ' || name, '[^a-zA-Z0-9 ]', ' ', 'g'))) stored,
  created_by uuid references public.profiles (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists products_category_idx on public.products (lower(category));

create table if not exists public.product_uses (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products (id) on delete cascade,
  project_id uuid references public.projects (id) on delete set null,
  expense_id uuid references public.expenses (id) on delete set null,
  quote_item_id uuid references public.quote_items (id) on delete set null,
  used_on date not null default current_date,
  price numeric(14,2),
  note text,
  created_by uuid references public.profiles (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists product_uses_product_idx on public.product_uses (product_id, used_on desc);

alter table public.products enable row level security;
alter table public.product_uses enable row level security;
do $$
declare t text;
begin
  foreach t in array array['products', 'product_uses'] loop
    if not exists (select 1 from pg_policies where tablename = t and policyname = 'remus_all') then
      execute format('create policy "remus_all" on public.%I for all to authenticated using ((select public.is_active_member())) with check ((select public.is_active_member()))', t);
      execute format('create policy "remus_write_insert" on public.%I as restrictive for insert to authenticated with check ((select public.can_write()))', t);
      execute format('create policy "remus_write_update" on public.%I as restrictive for update to authenticated using ((select public.can_write())) with check ((select public.can_write()))', t);
      execute format('create policy "remus_write_delete" on public.%I as restrictive for delete to authenticated using ((select public.can_write()))', t);
    end if;
  end loop;
end $$;
