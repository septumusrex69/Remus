-- The plan on the quotation, with a clause that it is an estimate (Stephan, 26 Oct 2026: "this is
-- an estimated plan... weather conditions or any other problem we might encounter can change this").
-- Each quote can leave the timeline off; the clause is the company's, editable in Settings, and is
-- always printed with the timeline.
alter table public.quotes add column if not exists show_plan boolean not null default true;

alter table public.company_settings add column if not exists plan_disclaimer text not null default
  'This timeline is an estimate based on our planning at the time of quoting. The actual programme '
  || 'may change because of weather, material availability, conditions found on site once work '
  || 'starts, changes requested by the client and other circumstances outside our control. Days '
  || 'are working days.';
