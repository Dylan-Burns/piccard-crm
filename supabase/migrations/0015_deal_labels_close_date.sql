-- 0015_deal_labels_close_date: labels and an expected close date on deals.
-- Approved by the owner on 2026-10-03 as an addition to the spec's schema (docs/decisions.md).
-- Both are descriptive fields: staff edit them directly, like the other descriptive deal columns.

-- Up to 10 labels, each trimmed and 1 to 30 characters, no duplicates.
create or replace function private.labels_valid(p text[]) returns boolean
language sql immutable set search_path = '' as $$
  select coalesce(cardinality(p), 0) <= 10
     and not exists (select 1 from unnest(p) l where l is null or l <> trim(l) or length(l) not between 1 and 30)
     and (select count(distinct lower(l)) from unnest(p) l) = coalesce(cardinality(p), 0)
$$;
revoke execute on function private.labels_valid(text[]) from public, anon;
-- The check runs as the user who writes the row (usage on `private` was granted in 0001).
grant execute on function private.labels_valid(text[]) to authenticated, service_role;

alter table public.opportunities
  add column labels text[] not null default '{}',
  add column expected_close_on date,
  add constraint opportunities_labels_valid check (private.labels_valid(labels));

create index opportunities_labels_idx on public.opportunities using gin (labels);

grant update (labels, expected_close_on) on public.opportunities to authenticated;
