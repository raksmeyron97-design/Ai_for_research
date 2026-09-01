-- Phase 2: Storage bucket for uploaded research documents.
--
-- Convention: storage_path = '{project_id}/{uuid}-{original_filename}'.
-- Storage RLS uses storage.foldername(name)[1] to read the project_id
-- segment back out of the path and check it against research_projects
-- ownership — the same isolation guarantee as the table RLS policies,
-- applied to the actual file bytes.

insert into storage.buckets (id, name, public)
values ('research-documents', 'research-documents', false)
on conflict (id) do nothing;

create policy "research_documents_storage_select" on storage.objects
  for select using (
    bucket_id = 'research-documents'
    and exists (
      select 1 from research_projects p
      where p.id::text = (storage.foldername(name))[1]
        and p.user_id = (select auth.uid())
    )
  );

create policy "research_documents_storage_insert" on storage.objects
  for insert with check (
    bucket_id = 'research-documents'
    and exists (
      select 1 from research_projects p
      where p.id::text = (storage.foldername(name))[1]
        and p.user_id = (select auth.uid())
    )
  );

create policy "research_documents_storage_delete" on storage.objects
  for delete using (
    bucket_id = 'research-documents'
    and exists (
      select 1 from research_projects p
      where p.id::text = (storage.foldername(name))[1]
        and p.user_id = (select auth.uid())
    )
  );

-- No update policy: uploads are treated as immutable; re-uploading a
-- changed file should create a new object rather than overwrite one.
