-- ============================================================================
-- Remus · Handover 8 (7 Nov 2026): THE PHOTOS IN A NEWSLETTER.
--
-- Stephan: newsletters like "We've finished a job in Brooklyn" carry site photos. An email is read in somebody
-- else's mail program, which cannot open Remus's private stores (the site diary's photos are behind short-lived
-- signed links that stop working within the hour). So a photo chosen for a newsletter -- picked from the diary
-- (only photos ticked "show the client") or uploaded -- is COPIED into this store, which is public: anybody with the
-- exact link can see that one picture, and nothing else (the links carry a random name; the store cannot be listed
-- by the public). Raptor's newsletter takes one picture link typed in by hand; Remus keeps the pictures itself.
--
-- Only Administrators (news_may_send, 0050) may add or remove pictures. Additive only.
-- ============================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('news-pictures', 'news-pictures', true, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'news_pictures_insert') then
    create policy "news_pictures_insert" on storage.objects for insert to authenticated
      with check (bucket_id = 'news-pictures' and (select public.news_may_send()));
    create policy "news_pictures_update" on storage.objects for update to authenticated
      using (bucket_id = 'news-pictures' and (select public.news_may_send()))
      with check (bucket_id = 'news-pictures' and (select public.news_may_send()));
    create policy "news_pictures_delete" on storage.objects for delete to authenticated
      using (bucket_id = 'news-pictures' and (select public.news_may_send()));
    -- Administrators may list what is there (the public reads single files by their link, without a policy).
    create policy "news_pictures_select" on storage.objects for select to authenticated
      using (bucket_id = 'news-pictures' and (select public.news_may_send()));
  end if;
end $$;
