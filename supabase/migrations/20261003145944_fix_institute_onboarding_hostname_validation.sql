-- Correct the onboarding hostname validator. Valid hostnames must satisfy the
-- allow-list below; the previous version accidentally matched non-whitespace
-- instead of rejecting whitespace.

do $$
declare
  v_oid oid;
  v_signature text;
begin
  select p.oid, p.oid::regprocedure::text
    into v_oid, v_signature
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname = 'platform_onboard_institute'
  order by p.oid desc
  limit 1;

  if v_oid is null then
    raise exception 'platform_onboard_institute function is missing';
  end if;
end
$$;

create or replace function public.platform_onboard_institute(
  p_name text,
  p_slug text,
  p_description text default null,
  p_institute_type text default null,
  p_phone text default null,
  p_email text default null,
  p_website_url text default null,
  p_address_line1 text default null,
  p_address_line2 text default null,
  p_city text default null,
  p_state text default null,
  p_postal_code text default null,
  p_country text default 'India',
  p_timezone text default 'Asia/Kolkata',
  p_locale text default 'en-IN',
  p_logo_url text default null,
  p_cover_image_url text default null,
  p_favicon_url text default null,
  p_logo_alt_text text default null,
  p_primary_color text default null,
  p_secondary_color text default null,
  p_login_title text default null,
  p_powered_by_enabled boolean default true,
  p_academic_year_name text default null,
  p_academic_year_start_date date default null,
  p_academic_year_end_date date default null,
  p_enabled_features text[] default null,
  p_custom_request_title text default null,
  p_custom_request_description text default null,
  p_hostname text default null
)
returns table (
  institute_id uuid,
  institute_name text,
  institute_slug text,
  institute_status text,
  domain_id uuid,
  domain_hostname text,
  verification_token text,
  academic_year_id text,
  custom_request_id uuid,
  enabled_feature_count integer
)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_id uuid;
  v_slug text;
  v_hostname text;
  v_domain_id uuid;
  v_token text;
  v_default_domain text;
  v_default_hostname text;
  v_default_subdomains_enabled boolean := false;
  v_academic_year_id text;
  v_custom_request_id uuid;
  v_enabled_codes text[] := array(
    select distinct lower(trim(code))
    from unnest(coalesce(p_enabled_features, array[]::text[])) as item(code)
    where trim(code) <> ''
  );
begin
  if not public.platform_owner_access_ok() then
    raise exception 'Platform owner MFA verification required';
  end if;

  v_slug := lower(trim(coalesce(p_slug,'')));
  if v_slug !~ '^[a-z0-9]+(?:-[a-z0-9]+)*$' or length(v_slug) > 63 then
    raise exception 'Invalid institute slug';
  end if;
  if length(trim(coalesce(p_name,''))) < 2 or length(trim(p_name)) > 180 then
    raise exception 'Invalid institute name';
  end if;
  if length(trim(coalesce(p_description,''))) > 2000 or length(trim(coalesce(p_institute_type,''))) > 80 then
    raise exception 'Institute profile field is too long';
  end if;

  if p_academic_year_start_date is not null
     or p_academic_year_end_date is not null
     or nullif(trim(coalesce(p_academic_year_name,'')),'') is not null
  then
    if nullif(trim(coalesce(p_academic_year_name,'')),'') is null
       or p_academic_year_start_date is null
       or p_academic_year_end_date is null
    then
      raise exception 'Academic year name, start date and end date must be provided together';
    end if;
    if p_academic_year_end_date < p_academic_year_start_date then
      raise exception 'Academic year end date must be on or after start date';
    end if;
  end if;

  if exists (
    select 1 from unnest(v_enabled_codes) as enabled(code)
    where not exists (
      select 1 from public.platform_features f
      where f.code = enabled.code and f.status = 'active'
    )
  ) then
    raise exception 'One or more selected institute features are unavailable';
  end if;

  if exists (
    select 1
    from public.platform_features f
    cross join lateral unnest(f.depends_on) as dep(code)
    where f.status = 'active'
      and f.code = any(v_enabled_codes)
      and not (dep.code = any(v_enabled_codes))
  ) then
    raise exception 'Selected institute features include unmet dependencies';
  end if;

  insert into public.institutes(
    name, slug, status, description, institute_type, phone, email, website_url,
    address_line1, address_line2, city, state, postal_code, country
  )
  values(
    trim(p_name), v_slug, 'trial',
    nullif(trim(coalesce(p_description,'')),''),
    nullif(trim(coalesce(p_institute_type,'')),''),
    nullif(trim(coalesce(p_phone,'')),''),
    nullif(lower(trim(coalesce(p_email,''))),''),
    nullif(trim(coalesce(p_website_url,'')),''),
    nullif(trim(coalesce(p_address_line1,'')),''),
    nullif(trim(coalesce(p_address_line2,'')),''),
    nullif(trim(coalesce(p_city,'')),''),
    nullif(trim(coalesce(p_state,'')),''),
    nullif(trim(coalesce(p_postal_code,'')),''),
    coalesce(nullif(trim(coalesce(p_country,'')),''),'India')
  )
  returning id into v_id;

  insert into public.institute_settings(
    institute_id, display_name, short_name, logo_url, cover_image_url, favicon_url,
    logo_alt_text, primary_color, secondary_color, login_title,
    powered_by_enabled, timezone, locale, settings
  )
  values(
    v_id, trim(p_name), left(trim(p_name),50),
    nullif(trim(coalesce(p_logo_url,'')),''),
    nullif(trim(coalesce(p_cover_image_url,'')),''),
    nullif(trim(coalesce(p_favicon_url,'')),''),
    nullif(trim(coalesce(p_logo_alt_text,'')),''),
    nullif(trim(coalesce(p_primary_color,'')),''),
    nullif(trim(coalesce(p_secondary_color,'')),''),
    nullif(trim(coalesce(p_login_title,'')),''),
    coalesce(p_powered_by_enabled,true),
    coalesce(nullif(trim(coalesce(p_timezone,'')),''),'Asia/Kolkata'),
    coalesce(nullif(trim(coalesce(p_locale,'')),''),'en-IN'),
    jsonb_build_object('onboarding_version',1,'public_contact_enabled',true)
  );

  perform public.seed_institute_defaults(v_id);

  insert into public.institute_feature_entitlements(
    institute_id, feature_code, enabled, configured_at, configured_by
  )
  select v_id, f.code, f.code = any(v_enabled_codes), now(), auth.uid()
  from public.platform_features f
  where f.status = 'active'
  on conflict (institute_id, feature_code) do update
    set enabled = excluded.enabled, configured_at = now(), configured_by = auth.uid();

  if nullif(trim(coalesce(p_academic_year_name,'')),'') is not null then
    v_academic_year_id := v_slug || '-initial-' || substr(replace(v_id::text,'-',''),1,12);
    insert into public.academic_years(
      id, name, start_date, end_date, status, created_at, updated_at, institute_id
    )
    values(v_academic_year_id, trim(p_academic_year_name),
      p_academic_year_start_date, p_academic_year_end_date, 'active', now(), now(), v_id);
  end if;

  select
    lower(trim(default_app_domain)),
    case
      when settings ? 'default_subdomains_enabled'
       and settings->>'default_subdomains_enabled' in ('true','false')
      then (settings->>'default_subdomains_enabled')::boolean
      else false
    end
  into v_default_domain, v_default_subdomains_enabled
  from public.platform_settings
  where id=1;

  if v_default_subdomains_enabled and nullif(v_default_domain,'') is not null then
    if v_default_domain ~ '^[^\s/]+://'
       or v_default_domain !~ '^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$'
       or v_default_domain !~ '\.'
    then
      raise exception 'Invalid platform default app domain';
    end if;
    v_default_hostname := v_slug || '.' || v_default_domain;
    if exists (select 1 from public.institute_domains where hostname=v_default_hostname) then
      raise exception 'Default tenant hostname is already registered';
    end if;
    insert into public.institute_domains(
      institute_id, hostname, domain_type, status, verification_method,
      verification_token, tls_status, is_primary
    )
    values(v_id, v_default_hostname, 'default_subdomain', 'verified', null, null, 'active', true)
    returning id into v_domain_id;
  end if;

  if nullif(trim(coalesce(p_hostname,'')),'') is not null then
    v_hostname := lower(trim(p_hostname));
    if v_hostname ~ '^[^\s/]+://'
       or v_hostname !~ '^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$'
       or v_hostname !~ '\.'
    then
      raise exception 'Invalid onboarding hostname';
    end if;
    if exists (select 1 from public.institute_domains where hostname=v_hostname) then
      raise exception 'Onboarding hostname is already registered';
    end if;
    v_token := encode(gen_random_bytes(18),'hex');
    insert into public.institute_domains(
      institute_id, hostname, domain_type, status, verification_method,
      verification_token, tls_status, is_primary
    )
    values(v_id, v_hostname, 'custom', 'pending', 'dns_txt', v_token, 'pending',
      case when v_domain_id is null then true else false end)
    returning id into v_domain_id;
  end if;

  if nullif(trim(coalesce(p_custom_request_title,'')),'') is not null
     or nullif(trim(coalesce(p_custom_request_description,'')),'') is not null
  then
    if nullif(trim(coalesce(p_custom_request_title,'')),'') is null
       or nullif(trim(coalesce(p_custom_request_description,'')),'') is null
    then
      raise exception 'Custom feature request title and description must be provided together';
    end if;
    v_custom_request_id := gen_random_uuid();
    insert into public.institute_custom_feature_requests(
      id, institute_id, requested_by, title, description, status
    )
    values(v_custom_request_id, v_id, auth.uid(),
      trim(p_custom_request_title), trim(p_custom_request_description), 'requested');
  end if;

  insert into public.audit_logs(
    scope,institute_id,actor_auth_id,action,entity_type,entity_id,summary,metadata
  )
  values(
    'platform',v_id,auth.uid(),'institute.onboarded','institute',v_id::text,
    'Institute onboarding completed from the multi-panel platform wizard.',
    jsonb_build_object(
      'name', trim(p_name),
      'slug', v_slug,
      'institute_type', nullif(trim(coalesce(p_institute_type,'')),''),
      'has_logo', nullif(trim(coalesce(p_logo_url,'')),'') is not null,
      'has_cover_image', nullif(trim(coalesce(p_cover_image_url,'')),'') is not null,
      'has_academic_year', v_academic_year_id is not null,
      'custom_request_created', v_custom_request_id is not null,
      'enabled_feature_count', cardinality(v_enabled_codes),
      'default_subdomain', case when v_default_subdomains_enabled then v_default_hostname else null end,
      'custom_hostname', case when p_hostname is not null then v_hostname else null end
    )
  );

  return query
  select i.id, i.name, i.slug, i.status, d.id, d.hostname, d.verification_token,
         v_academic_year_id, v_custom_request_id, cardinality(v_enabled_codes)
  from public.institutes i
  left join public.institute_domains d on d.id = v_domain_id
  where i.id = v_id;
end;
$function$;
