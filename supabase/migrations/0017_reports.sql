-- 0017_reports: reporting functions (spec §8), copied from the spec with names schema-qualified
-- and an empty search_path (spec §2.1). All are `security invoker`, so RLS applies: field users,
-- who cannot read deals, get zeros and empty tables. Dates are bucketed in the company timezone.
-- Deals lost as `duplicate` are excluded everywhere. Money is in cents.

create or replace function private.biz_date(ts timestamptz) returns date
language sql stable set search_path = '' as $$
  select (ts at time zone (select timezone from public.company_settings))::date
$$;
revoke execute on function private.biz_date(timestamptz) from public, anon;
grant execute on function private.biz_date(timestamptz) to authenticated, service_role;

-- 8.1 Dashboard tiles
create or replace function public.report_dashboard(p_from date, p_to date, p_owner uuid default null)
returns table (
  new_leads bigint, won_count bigint, lost_count bigint, close_rate numeric,
  sold_cents bigint, pipeline_cents bigint, active_jobs bigint,
  upcoming_appointments bigint, invoiced_cents bigint, outstanding_cents bigint
) language sql stable security invoker set search_path = '' as $$
  -- open work is attributed to the current owner; closed results to the owner at close.
  with o as (
    select * from public.opportunities
    where (p_owner is null or owner_id = p_owner)
      and lost_reason is distinct from 'duplicate'
  ),
  closed as (
    select * from public.opportunities
    where (p_owner is null or closed_owner_id = p_owner)
      and lost_reason is distinct from 'duplicate'
  ),
  w as (select count(*) c, coalesce(sum(amount_cents),0) s from closed
        where stage = 'won'  and private.biz_date(won_at)  between p_from and p_to),
  l as (select count(*) c from closed
        where stage = 'lost' and private.biz_date(lost_at) between p_from and p_to)
  select
    (select count(*) from o where private.biz_date(created_at) between p_from and p_to),
    w.c, l.c,
    case when w.c + l.c = 0 then null else round(w.c::numeric / (w.c + l.c), 4) end,
    w.s::bigint,
    (select coalesce(sum(estimated_value_cents),0)::bigint from o where stage not in ('won','lost')),
    (select count(*) from public.jobs j join o on o.id = j.opportunity_id
      where j.status in ('pending_schedule','scheduled','in_progress','on_hold')),
    (select count(*) from public.appointments a join o on o.id = a.opportunity_id
      where a.status = 'scheduled' and a.starts_at >= now() and a.starts_at < now() + interval '7 days'),
    (select coalesce(sum(i.total_cents),0)::bigint from public.invoices i join public.jobs j on j.id = i.job_id join o on o.id = j.opportunity_id
      where i.status in ('sent','partially_paid','paid') and i.issued_on between p_from and p_to),
    (select coalesce(sum(i.total_cents - i.amount_paid_cents),0)::bigint from public.invoices i join public.jobs j on j.id = i.job_id join o on o.id = j.opportunity_id
      where i.status in ('sent','partially_paid'))
  from w, l
$$;

-- 8.2 Leads by source (cohort: deals created in the period)
create or replace function public.report_leads_by_source(p_from date, p_to date)
returns table (source text, leads bigint, won bigint, lost bigint, open bigint,
               cohort_conversion numeric, sold_cents bigint)
language sql stable security invoker set search_path = '' as $$
  select coalesce(s.name, 'Unknown'),
         count(*),
         count(*) filter (where o.stage = 'won'),
         count(*) filter (where o.stage = 'lost'),
         count(*) filter (where o.stage not in ('won','lost')),
         round(count(*) filter (where o.stage = 'won')::numeric / count(*), 4),
         coalesce(sum(o.amount_cents) filter (where o.stage = 'won'), 0)::bigint
  from public.opportunities o left join public.lead_sources s on s.id = o.source_id
  where private.biz_date(o.created_at) between p_from and p_to
    and o.lost_reason is distinct from 'duplicate'
  group by 1 order by 2 desc, 1
$$;

-- 8.3 Pipeline dollars by stage (current snapshot)
create or replace function public.report_pipeline_by_stage(p_owner uuid default null)
returns table (stage public.opportunity_stage, deals bigint, value_cents bigint, avg_days_in_stage numeric)
language sql stable security invoker set search_path = '' as $$
  select o.stage, count(*), coalesce(sum(o.estimated_value_cents),0)::bigint,
         round(avg(extract(epoch from now() - o.stage_entered_at) / 86400)::numeric, 1)
  from public.opportunities o
  where o.stage not in ('won','lost') and (p_owner is null or o.owner_id = p_owner)
  group by o.stage order by o.stage
$$;

-- 8.4 Sold revenue by month (last p_months months, by won_at)
create or replace function public.report_revenue_by_month(p_months integer default 12)
returns table (month date, won_count bigint, sold_cents bigint)
language sql stable security invoker set search_path = '' as $$
  select date_trunc('month', private.biz_date(o.won_at))::date, count(*), coalesce(sum(o.amount_cents),0)::bigint
  from public.opportunities o
  where o.stage = 'won'
    and private.biz_date(o.won_at) >= (date_trunc('month', private.biz_date(now())) - make_interval(months => p_months - 1))::date
  group by 1 order by 1
$$;

-- 8.5 Sales rep performance
-- Leads assigned: deals created in the period, by current owner.
-- Won / lost / sold / days to close: deals closed in the period, by closed_owner_id (owner at close).
-- Speed-to-lead: median minutes from creation to first contact ATTEMPT, by who attempted it.
create or replace function public.report_rep_performance(p_from date, p_to date)
returns table (owner_id uuid, owner_name text, leads_assigned bigint, won bigint, lost bigint,
               close_rate numeric, sold_cents bigint, avg_days_to_close numeric,
               median_minutes_to_first_attempt numeric, overdue_tasks bigint)
language sql stable security invoker set search_path = '' as $$
  with reps as (
    select id, full_name from public.profiles where role in ('admin','sales') and is_active
  ),
  assigned as (
    select o.owner_id as rep, count(*) n from public.opportunities o
    where private.biz_date(o.created_at) between p_from and p_to and o.lost_reason is distinct from 'duplicate'
    group by o.owner_id
  ),
  closed as (
    select o.closed_owner_id as rep,
           count(*) filter (where o.stage = 'won')  as won,
           count(*) filter (where o.stage = 'lost') as lost,
           coalesce(sum(o.amount_cents) filter (where o.stage = 'won'), 0) as sold,
           avg(extract(epoch from o.won_at - o.created_at) / 86400) filter (where o.stage = 'won') as days
    from public.opportunities o
    where o.lost_reason is distinct from 'duplicate'
      and ((o.stage = 'won'  and private.biz_date(o.won_at)  between p_from and p_to)
        or (o.stage = 'lost' and private.biz_date(o.lost_at) between p_from and p_to))
    group by o.closed_owner_id
  ),
  speed as (
    select o.first_contact_attempted_by as rep,
           percentile_cont(0.5) within group (order by extract(epoch from o.first_contact_attempted_at - o.created_at) / 60) as minutes
    from public.opportunities o
    where o.first_contact_attempted_at is not null and private.biz_date(o.created_at) between p_from and p_to
    group by o.first_contact_attempted_by
  )
  select r.id, r.full_name,
         coalesce(a.n, 0),
         coalesce(c.won, 0),
         coalesce(c.lost, 0),
         round(c.won::numeric / nullif(c.won + c.lost, 0), 4),
         coalesce(c.sold, 0)::bigint,
         round(c.days::numeric, 1),
         round(s.minutes::numeric, 0),
         (select count(*) from public.tasks t where t.assigned_to = r.id and t.status = 'open' and t.due_at < now())
  from reps r
  left join assigned a on a.rep = r.id
  left join closed   c on c.rep = r.id
  left join speed    s on s.rep = r.id
  order by 7 desc, 2
$$;

-- 8.6 Lost reasons (deals lost in the period)
create or replace function public.report_lost_reasons(p_from date, p_to date)
returns table (reason public.lost_reason, deals bigint, value_cents bigint)
language sql stable security invoker set search_path = '' as $$
  select o.lost_reason, count(*), coalesce(sum(o.estimated_value_cents),0)::bigint
  from public.opportunities o
  where o.stage = 'lost' and o.lost_reason <> 'duplicate' and private.biz_date(o.lost_at) between p_from and p_to
  group by 1 order by 2 desc, 1
$$;

revoke execute on function public.report_dashboard(date, date, uuid), public.report_leads_by_source(date, date),
  public.report_pipeline_by_stage(uuid), public.report_revenue_by_month(integer),
  public.report_rep_performance(date, date), public.report_lost_reasons(date, date) from public, anon;
grant execute on function public.report_dashboard(date, date, uuid), public.report_leads_by_source(date, date),
  public.report_pipeline_by_stage(uuid), public.report_revenue_by_month(integer),
  public.report_rep_performance(date, date), public.report_lost_reasons(date, date) to authenticated, service_role;
