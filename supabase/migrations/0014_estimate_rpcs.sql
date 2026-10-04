-- 0014_estimate_rpcs: create_estimate, save_estimate_lines, void_estimate (spec §4.6, §7).

create or replace function private.estimate_label(p_number bigint, p_version integer) returns text
language sql immutable set search_path = '' as $$
  select 'E-' || p_number || case when p_version > 1 then '-v' || p_version else '' end
$$;
revoke execute on function private.estimate_label(bigint, integer) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- create_estimate (staff): a draft with tax rate, deposit percent, terms, and valid-until
-- copied from company settings. Later settings changes do not touch it.
-- ---------------------------------------------------------------------------
create or replace function public.create_estimate(p_opportunity_id uuid, p_title text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  o record;
  s record;
  v_id uuid;
  v_number bigint;
begin
  if not private.is_staff() then
    raise exception 'not allowed' using errcode = 'insufficient_privilege';
  end if;
  select id, title, stage into o from public.opportunities where id = p_opportunity_id;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found', 'message', 'Deal not found');
  end if;
  if o.stage in ('won', 'lost') then
    return jsonb_build_object('ok', false, 'code', 'deal_closed', 'message', 'This deal is closed. Reopen it to add an estimate.');
  end if;

  select default_tax_rate, default_deposit_percent, estimate_terms, estimate_valid_days, timezone into s
    from public.company_settings;

  insert into public.estimates (opportunity_id, title, terms, tax_rate, deposit_percent, valid_until, created_by)
  values (p_opportunity_id,
          coalesce(nullif(trim(p_title), ''), o.title),
          coalesce(s.estimate_terms, ''),
          coalesce(s.default_tax_rate, 0),
          coalesce(s.default_deposit_percent, 0),
          (now() at time zone coalesce(s.timezone, 'America/New_York'))::date + coalesce(s.estimate_valid_days, 30),
          auth.uid())
  returning id, estimate_number into v_id, v_number;

  perform private.log_activity('estimate_created', p_opportunity_id, null,
    'Estimate ' || private.estimate_label(v_number, 1) || ' created',
    jsonb_build_object('estimate_id', v_id));

  return jsonb_build_object('ok', true, 'estimate_id', v_id, 'estimate_number', v_number);
end $$;

-- ---------------------------------------------------------------------------
-- save_estimate_lines (staff): replaces a draft's lines with p_lines, in array order.
-- Totals are recalculated by the line trigger.
-- p_lines: [{name, [description], quantity, [unit], unit_price_cents, [is_taxable]}]
-- ---------------------------------------------------------------------------
create or replace function public.save_estimate_lines(p_estimate_id uuid, p_lines jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  e record;
  v_lines jsonb := coalesce(p_lines, '[]'::jsonb);
begin
  if not private.is_staff() then
    raise exception 'not allowed' using errcode = 'insufficient_privilege';
  end if;
  select id, status into e from public.estimates where id = p_estimate_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found', 'message', 'Estimate not found');
  end if;
  if e.status <> 'draft' then
    return jsonb_build_object('ok', false, 'code', 'locked', 'message', 'Only a draft estimate can be edited');
  end if;
  if jsonb_typeof(v_lines) <> 'array' or jsonb_array_length(v_lines) > 200 then
    return jsonb_build_object('ok', false, 'code', 'invalid', 'message', 'An estimate can have up to 200 lines');
  end if;
  if exists (
    select 1 from jsonb_array_elements(v_lines) l
     where coalesce(length(trim(l->>'name')) between 1 and 300, false) is not true
        or coalesce((l->>'quantity') ~ '^[0-9]{1,8}(\.[0-9]{1,2})?$' and (l->>'quantity')::numeric > 0, false) is not true
        or coalesce((l->>'unit_price_cents') ~ '^[0-9]{1,9}$', false) is not true
        or coalesce(length(l->>'unit') <= 20, true) is not true
        or (l ? 'is_taxable' and jsonb_typeof(l->'is_taxable') <> 'boolean')
        -- a line total must fit the integer column
        or coalesce((l->>'quantity')::numeric * (l->>'unit_price_cents')::numeric <= 2000000000, false) is not true
  ) then
    return jsonb_build_object('ok', false, 'code', 'invalid', 'message', 'Each line needs a name, a quantity above zero, and a price');
  end if;

  delete from public.estimate_line_items where estimate_id = p_estimate_id;
  insert into public.estimate_line_items (estimate_id, sort_order, name, description, quantity, unit, unit_price_cents, is_taxable)
  select p_estimate_id, (ordinality - 1)::integer, trim(l->>'name'), nullif(trim(l->>'description'), ''),
         (l->>'quantity')::numeric(10,2), coalesce(nullif(trim(l->>'unit'), ''), 'ea'),
         (l->>'unit_price_cents')::integer, coalesce((l->>'is_taxable')::boolean, true)
    from jsonb_array_elements(v_lines) with ordinality as t(l, ordinality);

  return (select jsonb_build_object('ok', true, 'subtotal_cents', subtotal_cents, 'tax_cents', tax_cents,
                                    'total_cents', total_cents, 'deposit_cents', deposit_cents)
            from public.estimates where id = p_estimate_id);
end $$;

-- ---------------------------------------------------------------------------
-- void_estimate (staff): draft, sent, viewed, or expired only.
-- ---------------------------------------------------------------------------
create or replace function public.void_estimate(p_estimate_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare e record;
begin
  if not private.is_staff() then
    raise exception 'not allowed' using errcode = 'insufficient_privilege';
  end if;
  select id, status, opportunity_id, estimate_number, version into e from public.estimates where id = p_estimate_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found', 'message', 'Estimate not found');
  end if;
  if e.status = 'void' then
    return jsonb_build_object('ok', true, 'already', true);
  end if;
  if e.status not in ('draft', 'sent', 'viewed', 'expired') then
    return jsonb_build_object('ok', false, 'code', 'invalid_status',
      'message', 'An ' || e.status || ' estimate cannot be voided');
  end if;

  update public.estimates set status = 'void' where id = p_estimate_id;
  perform private.log_activity('system', e.opportunity_id, null,
    'Estimate ' || private.estimate_label(e.estimate_number, e.version) || ' voided',
    jsonb_build_object('estimate_id', e.id, 'from', e.status));
  return jsonb_build_object('ok', true);
end $$;

revoke execute on function public.create_estimate(uuid, text), public.save_estimate_lines(uuid, jsonb), public.void_estimate(uuid)
  from public, anon, authenticated;
grant execute on function public.create_estimate(uuid, text), public.save_estimate_lines(uuid, jsonb), public.void_estimate(uuid)
  to authenticated, service_role;
