-- ============================================================================
-- Remus · Handover 8 (3 Nov 2026): OVERHEADS, BY KIND. Stephan: "you should be able to choose ... this is overheads or
-- this is for a job. And if it's overheads, what is the category? ... internet, or ... car maintenance."
-- A slip on no project is an overhead; this says which kind (src/lib/overheads.ts lists them: internet_phone,
-- vehicle_fuel, vehicle_maintenance ...). Free text, not a check, so the list can grow without a migration.
-- Additive only.
-- ============================================================================
alter table public.expenses add column if not exists overhead_kind text;
create index if not exists expenses_overhead_kind_idx on public.expenses (overhead_kind) where overhead_kind is not null;
