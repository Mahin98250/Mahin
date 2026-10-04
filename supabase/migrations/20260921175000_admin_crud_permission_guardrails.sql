-- Admin 10X CRUD/read authorization guardrails.
-- The tenant-boundary policies already restrict access to active institute members.
-- These additional RESTRICTIVE policies require the canonical permission for each
-- institute-owned domain, so direct PostgREST table access cannot bypass the UI.
-- Platform members remain allowed because platform control-plane access is separate.

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
    array['rooms','academics.read'],
    array['subjects','academics.read'],
    array['test_results','assessments.read'],
    array['tests','assessments.read'],
    array['timetable','timetable.read'],
    array['timetable_entries','timetable.read'],
    array['parent_student_links','guardians.read']
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
    array['rooms','academics.manage'],
    array['subjects','academics.manage'],
    array['test_results','assessments.manage'],
    array['tests','assessments.manage'],
    array['timetable','timetable.manage'],
    array['timetable_entries','timetable.manage'],
    array['parent_student_links','guardians.manage']
  ];
begin
  -- Fail closed if a mapped table ever loses its tenant boundary.
  foreach item slice 1 in array read_tables loop
    if to_regclass(format('public.%I', item[1])) is null
       or not exists (
         select 1
         from information_schema.columns
         where table_schema = 'public'
           and table_name = item[1]
           and column_name = 'institute_id'
       ) then
      raise exception 'Admin permission guardrail requires public.%.institute_id', item[1];
    end if;
  end loop;

  foreach item slice 1 in array write_tables loop
    if to_regclass(format('public.%I', item[1])) is null
       or not exists (
         select 1
         from information_schema.columns
         where table_schema = 'public'
           and table_name = item[1]
           and column_name = 'institute_id'
       ) then
      raise exception 'Admin permission guardrail requires public.%.institute_id', item[1];
    end if;
  end loop;

  foreach item slice 1 in array read_tables loop
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
