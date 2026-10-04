-- Admin 10X CRUD/read authorization guardrails.
-- The tenant-boundary policies already restrict access to active institute members.
-- These additional RESTRICTIVE policies require the canonical permission for each
-- institute-owned domain, so direct PostgREST table access cannot bypass the UI.
--
-- IMPORTANT: public.users is a legacy/global compatibility table and does not have
-- institute_id. It is intentionally excluded from these tenant-row policies.
-- Account provisioning/credential operations must use the hardened Edge Function
-- and the tenant-scoped membership/account checks rather than treating public.users
-- as an institute-owned CRUD table.

do $$
declare
  item record;
  read_tables text[][] := array[
    array['students','students.read'],
    array['teachers','teachers.read'],
    array['academic_years','academics.read'],
    array['announcements','announcements.read'],
    array['attendance','attendance.read'],
    array['batch_students','academics.read'],
    array['batch_teachers','academics.read'],
    array['batches','academics.read'],
    array['examschedule','assessments.read'],
    array['fees','fees.read'],
    array['homework','homework.read'],
    array['leave_requests','attendance.read'],
    array['marks','assessments.read'],
    array['material_folders','materials.read'],
    array['materials','materials.read'],
    array['parent_student_links','guardians.read'],
    array['rooms','academics.read'],
    array['subjects','academics.read'],
    array['test_results','assessments.read'],
    array['tests','assessments.read'],
    array['timetable','timetable.read'],
    array['timetable_entries','timetable.read']
  ];
  write_tables text[][] := array[
    array['students','students.manage'],
    array['teachers','teachers.manage'],
    array['academic_years','academics.manage'],
    array['announcements','announcements.manage'],
    array['attendance','attendance.manage'],
    array['batch_students','academics.manage'],
    array['batch_teachers','academics.manage'],
    array['batches','academics.manage'],
    array['examschedule','assessments.manage'],
    array['fees','fees.manage'],
    array['homework','homework.manage'],
    array['leave_requests','attendance.manage'],
    array['marks','assessments.manage'],
    array['material_folders','materials.manage'],
    array['materials','materials.manage'],
    array['parent_student_links','guardians.manage'],
    array['rooms','academics.manage'],
    array['subjects','academics.manage'],
    array['test_results','assessments.manage'],
    array['tests','assessments.manage'],
    array['timetable','timetable.manage'],
    array['timetable_entries','timetable.manage']
  ];
begin
  foreach item slice 1 in array read_tables loop
    if not exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = item[1]
        and column_name = 'institute_id'
    ) then
      raise exception 'Admin 10X migration requires public.%.institute_id', item[1];
    end if;

    execute format(
      'drop policy if exists %I on public.%I',
      'admin_permission_read_' || item[1],
      item[1]
    );
    execute format(
      'create policy %I on public.%I as restrictive for select to authenticated using (public.is_platform_member() or public.user_has_institute_permission(institute_id, %L))',
      'admin_permission_read_' || item[1],
      item[1],
      item[2]
    );
  end loop;

  foreach item slice 1 in array write_tables loop
    if not exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = item[1]
        and column_name = 'institute_id'
    ) then
      raise exception 'Admin 10X migration requires public.%.institute_id', item[1];
    end if;

    execute format(
      'drop policy if exists %I on public.%I',
      'admin_permission_insert_' || item[1],
      item[1]
    );
    execute format(
      'create policy %I on public.%I as restrictive for insert to authenticated with check (public.is_platform_member() or public.user_has_institute_permission(institute_id, %L))',
      'admin_permission_insert_' || item[1],
      item[1],
      item[2]
    );

    execute format(
      'drop policy if exists %I on public.%I',
      'admin_permission_update_' || item[1],
      item[1]
    );
    execute format(
      'create policy %I on public.%I as restrictive for update to authenticated using (public.is_platform_member() or public.user_has_institute_permission(institute_id, %L)) with check (public.is_platform_member() or public.user_has_institute_permission(institute_id, %L))',
      'admin_permission_update_' || item[1],
      item[1],
      item[2],
      item[2]
    );

    execute format(
      'drop policy if exists %I on public.%I',
      'admin_permission_delete_' || item[1],
      item[1]
    );
    execute format(
      'create policy %I on public.%I as restrictive for delete to authenticated using (public.is_platform_member() or public.user_has_institute_permission(institute_id, %L))',
      'admin_permission_delete_' || item[1],
      item[1],
      item[2]
    );
  end loop;
end
$$;

comment on policy admin_permission_read_students on public.students is
  'Admin 10X: student reads require students.read; platform members remain allowed.';
comment on policy admin_permission_update_students on public.students is
  'Admin 10X: student writes require students.manage; platform members remain allowed.';


-- Storage 100X guardrails:
-- Database-row RLS does not protect the Storage API. Existing storage policies
-- historically treated every admin as a global bucket administrator. Keep
-- non-admin behavior unchanged, but require the canonical institute permission
-- for admin access and bind new uploads to an institute-prefixed path.
do $$
begin
  execute $sql$
    create policy admin_permission_materials_storage_read
      on storage.objects as restrictive
      for select to authenticated
      using (
        bucket_id <> 'materials'
        or public.app_role() <> 'admin'
        or exists (
          select 1
          from public.materials m
          where m.storage_path = storage.objects.name
            and public.user_has_institute_permission(m.institute_id, 'materials.read')
        )
      )
  $sql$;
  execute $sql$
    create policy admin_permission_materials_storage_insert
      on storage.objects as restrictive
      for insert to authenticated
      with check (
        bucket_id <> 'materials'
        or public.app_role() <> 'admin'
        or (
          split_part(name, '/', 1) = 'institute'
          and split_part(name, '/', 2) ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
          and public.user_has_institute_permission(split_part(name, '/', 2)::uuid, 'materials.manage')
        )
      )
  $sql$;
  execute $sql$
    create policy admin_permission_materials_storage_update
      on storage.objects as restrictive
      for update to authenticated
      using (
        bucket_id <> 'materials'
        or public.app_role() <> 'admin'
        or exists (
          select 1
          from public.materials m
          where m.storage_path = storage.objects.name
            and public.user_has_institute_permission(m.institute_id, 'materials.manage')
        )
      )
      with check (
        bucket_id <> 'materials'
        or public.app_role() <> 'admin'
        or exists (
          select 1
          from public.materials m
          where m.storage_path = storage.objects.name
            and public.user_has_institute_permission(m.institute_id, 'materials.manage')
        )
      )
  $sql$;
  execute $sql$
    create policy admin_permission_materials_storage_delete
      on storage.objects as restrictive
      for delete to authenticated
      using (
        bucket_id <> 'materials'
        or public.app_role() <> 'admin'
        or exists (
          select 1
          from public.materials m
          where m.storage_path = storage.objects.name
            and public.user_has_institute_permission(m.institute_id, 'materials.manage')
        )
      )
  $sql$;

  execute $sql$
    create policy admin_permission_homework_storage_read
      on storage.objects as restrictive
      for select to authenticated
      using (
        bucket_id <> 'homework'
        or public.app_role() <> 'admin'
        or exists (
          select 1
          from public.homework h
          where h.storage_path = storage.objects.name
            and public.user_has_institute_permission(h.institute_id, 'homework.read')
        )
      )
  $sql$;
  execute $sql$
    create policy admin_permission_homework_storage_insert
      on storage.objects as restrictive
      for insert to authenticated
      with check (
        bucket_id <> 'homework'
        or public.app_role() <> 'admin'
        or (
          split_part(name, '/', 1) = 'institute'
          and split_part(name, '/', 2) ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
          and public.user_has_institute_permission(split_part(name, '/', 2)::uuid, 'homework.manage')
        )
      )
  $sql$;
  execute $sql$
    create policy admin_permission_homework_storage_update
      on storage.objects as restrictive
      for update to authenticated
      using (
        bucket_id <> 'homework'
        or public.app_role() <> 'admin'
        or exists (
          select 1
          from public.homework h
          where h.storage_path = storage.objects.name
            and public.user_has_institute_permission(h.institute_id, 'homework.manage')
        )
      )
      with check (
        bucket_id <> 'homework'
        or public.app_role() <> 'admin'
        or exists (
          select 1
          from public.homework h
          where h.storage_path = storage.objects.name
            and public.user_has_institute_permission(h.institute_id, 'homework.manage')
        )
      )
  $sql$;
  execute $sql$
    create policy admin_permission_homework_storage_delete
      on storage.objects as restrictive
      for delete to authenticated
      using (
        bucket_id <> 'homework'
        or public.app_role() <> 'admin'
        or exists (
          select 1
          from public.homework h
          where h.storage_path = storage.objects.name
            and public.user_has_institute_permission(h.institute_id, 'homework.manage')
        )
      )
  $sql$;
end
$$;

comment on policy admin_permission_materials_storage_insert on storage.objects is
  'Admin 100X: new material uploads must use institute/<institute_id>/... and materials.manage.';
comment on policy admin_permission_homework_storage_insert on storage.objects is
  'Admin 100X: new homework uploads must use institute/<institute_id>/... and homework.manage.';


-- Replace legacy global-admin storage readability with institute permission checks.
create or replace function public.homework_storage_readable(p_path text)
returns boolean
language plpgsql
stable security definer
set search_path = public, pg_temp
as $function$
declare h record;
begin
  select id,batch_id,cls,sec,tid,institute_id into h
  from public.homework
  where storage_path=p_path
  limit 1;
  if not found then return false; end if;
  if public.app_role()='admin' then
    return public.user_has_institute_permission(h.institute_id,'homework.read');
  end if;
  if public.app_role()='teacher' then
    return h.tid=public.current_ref() or (h.batch_id is not null and public.teacher_can_access_batch(h.batch_id,public.current_ref()));
  end if;
  if public.app_role()='student' then
    return public.student_can_access_batch(h.batch_id,public.current_ref());
  end if;
  if public.app_role()='parent' then
    return exists(select 1 from public.parent_student_links psl join public.batch_students bs on bs.student_id=psl.student_id and bs.batch_id=h.batch_id where psl.parent_auth_id=auth.uid() and psl.status='active' and bs.status='active' and bs.left_at is null);
  end if;
  return false;
end;
$function$;

create or replace function public.material_storage_object_readable(object_name text)
returns boolean
language sql
stable security definer
set search_path = public, pg_temp
as $function$
  select case
    when public.app_role() not in ('student','parent','teacher','admin') then false
    when public.app_role() = 'admin' then exists (
      select 1
      from public.materials m
      where m.storage_path = object_name
        and public.user_has_institute_permission(m.institute_id,'materials.read')
    )
    when exists (
      select 1
      from public.materials m
      where m.storage_path = object_name
        and (
          (public.app_role() = 'teacher' and (
            m.tid = public.current_ref()
            or (m.folder_id is not null and public.teacher_material_folder_accessible(m.folder_id, public.current_ref()))
            or (m.folder_id is null and m.batch_id is not null and public.teacher_can_access_batch(m.batch_id, public.current_ref()))
          ))
          or (public.app_role() in ('student','parent') and (
            (m.folder_id is not null and public.material_folder_standard_accessible(m.folder_id, public.current_ref()))
            or (m.folder_id is null and public.material_row_readable(m.batch_id, m.cls, m.sec))
          ))
        )
    ) then true
    else false
  end;
$function$;
