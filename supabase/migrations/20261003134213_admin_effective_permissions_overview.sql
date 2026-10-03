-- Institute Admin 10X: return the current user's effective permission catalog for one
-- institute in a single, secure read. This is a UX helper only; RLS remains the
-- authoritative data-access boundary.
create or replace function public.get_current_institute_permissions(p_institute_id uuid)
returns table(permission_code text)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select distinct p.code
  from public.permissions p
  where exists (
    select 1
    from public.institute_memberships m
    join public.people pe on pe.id = m.person_id
    join public.institute_roles r on r.id = m.role_id
    where m.institute_id = p_institute_id
      and m.status = 'active'
      and pe.auth_id = auth.uid()
      and pe.status = 'active'
      and r.status = 'active'
      and (
        exists (
          select 1
          from public.institute_role_permissions rp
          where rp.role_id = r.id
            and rp.permission_code = p.code
        )
        or exists (
          select 1
          from public.institute_membership_permission_overrides o
          where o.membership_id = m.id
            and o.permission_code = p.code
            and o.effect = 'allow'
        )
      )
      and not exists (
        select 1
        from public.institute_membership_permission_overrides o
        where o.membership_id = m.id
          and o.permission_code = p.code
          and o.effect = 'deny'
      )
  )
  order by p.code;
$$;

revoke all on function public.get_current_institute_permissions(uuid) from public, anon;
grant execute on function public.get_current_institute_permissions(uuid) to authenticated;

comment on function public.get_current_institute_permissions(uuid) is
  'Returns effective permission codes for the authenticated user in one institute; never grants data access by itself.';
