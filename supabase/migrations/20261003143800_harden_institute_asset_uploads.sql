-- Institute assets are publicly readable for tenant branding, but writes are Owner-MFA protected.

drop policy if exists institute_assets_platform_insert on storage.objects;
create policy institute_assets_platform_insert
on storage.objects
for insert to authenticated
with check (
  bucket_id = 'institute-assets'
  and (select public.platform_owner_access_ok())
  and (storage.foldername(name))[1] in ('onboarding','institutes')
);

drop policy if exists institute_assets_platform_update on storage.objects;
create policy institute_assets_platform_update
on storage.objects
for update to authenticated
using (
  bucket_id = 'institute-assets'
  and (select public.platform_owner_access_ok())
)
with check (
  bucket_id = 'institute-assets'
  and (select public.platform_owner_access_ok())
);

drop policy if exists institute_assets_platform_delete on storage.objects;
create policy institute_assets_platform_delete
on storage.objects
for delete to authenticated
using (
  bucket_id = 'institute-assets'
  and (select public.platform_owner_access_ok())
);
