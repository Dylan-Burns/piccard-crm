-- 0019_email_linking: linked mailboxes and synced customer email.
-- An addition to the spec's schema, approved by the owner on 2026-10-03 (docs/decisions.md).
--
-- Each staff user can link one Google Workspace or Microsoft 365 mailbox. Only messages to or
-- from an address that belongs to a customer are ever stored; the rest of a mailbox is not.
-- All staff can read stored messages (they belong to deals, which all staff can see).
-- Field users have no access: messages can contain prices.

create type public.email_provider  as enum ('google', 'microsoft');
create type public.email_direction as enum ('inbound', 'outbound');

create table public.email_accounts (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null unique references public.profiles(id) on delete cascade,   -- one mailbox per user
  provider          public.email_provider not null,
  email_address     extensions.citext not null,
  status            text not null default 'connected' check (status in ('connected', 'error', 'disconnected')),
  access_token_enc  text,                 -- AES-256-GCM, key in env INTEGRATION_ENCRYPTION_KEY
  refresh_token_enc text,
  expires_at        timestamptz,
  synced_through    timestamptz,          -- messages up to this time have been checked
  last_synced_at    timestamptz,
  last_error        text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create table public.email_messages (
  id                  uuid primary key default gen_random_uuid(),
  -- The email's own Message-ID header: one row per real email, even if two reps' mailboxes both hold it.
  internet_message_id text not null unique,
  account_id          uuid references public.email_accounts(id) on delete set null,   -- kept when the mailbox is unlinked or the rep leaves
  provider            public.email_provider not null,
  provider_message_id text not null,
  thread_id           text,
  direction           public.email_direction not null,
  from_address        extensions.citext not null,
  from_name           text,
  to_addresses        extensions.citext[] not null default '{}',
  cc_addresses        extensions.citext[] not null default '{}',
  subject             text not null default '',
  snippet             text not null default '',
  body_text           text not null default '',
  has_attachments     boolean not null default false,
  sent_at             timestamptz not null,
  customer_id         uuid not null references public.customers(id) on delete cascade,
  opportunity_id      uuid references public.opportunities(id) on delete set null,
  created_at          timestamptz not null default now()
);
create index email_messages_customer_idx on public.email_messages (customer_id, sent_at desc);
create index email_messages_opp_idx      on public.email_messages (opportunity_id, sent_at desc) where opportunity_id is not null;
create index email_messages_thread_idx   on public.email_messages (thread_id) where thread_id is not null;

create trigger email_accounts_set_updated_at before update on public.email_accounts
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------------
-- Access
-- ---------------------------------------------------------------------------
alter table public.email_accounts enable row level security;
alter table public.email_messages enable row level security;

-- A user sees their own mailbox's status; admins see everyone's. Tokens are never granted.
create policy email_accounts_select on public.email_accounts for select to authenticated
  using ((select private.is_staff()) and (user_id = auth.uid() or (select private.is_admin())));
grant select (id, user_id, provider, email_address, status, synced_through, last_synced_at, last_error, created_at)
  on public.email_accounts to authenticated;

-- All staff read customer email. Nobody writes it directly: rows come from record_email_message.
create policy email_messages_select on public.email_messages for select to authenticated
  using ((select private.is_staff()));
grant select on public.email_messages to authenticated;

-- ---------------------------------------------------------------------------
-- Which addresses may be treated as a customer's.
--
-- Any staff user can create a customer with any email address, and stored email is readable by
-- all staff. Without limits, adding a colleague's address (or the owner's accountant's) as a
-- "customer" would copy other people's mail with that address onto a deal. So:
--   * a staff member's address, a linked mailbox's address, and any address on the company's own
--     email domain are never customers;
--   * a mailbox is searched in the background only for customers on deals its owner owns.
-- ---------------------------------------------------------------------------
create or replace function private.is_internal_email(p_address text) returns boolean
language sql stable security definer set search_path = '' as $$
  with a as (select lower(trim(p_address)) as address, split_part(lower(trim(p_address)), '@', 2) as domain)
  select exists (select 1 from public.profiles p, a where lower(p.email::text) = a.address)
      or exists (select 1 from public.email_accounts e, a where lower(e.email_address::text) = a.address)
      -- The company's own domain, unless staff use a public mail provider (then only exact addresses count).
      or exists (
           select 1 from a
            where a.domain not in ('gmail.com', 'googlemail.com', 'outlook.com', 'hotmail.com', 'live.com', 'msn.com', 'yahoo.com',
                                   'icloud.com', 'me.com', 'aol.com', 'proton.me', 'protonmail.com')
              and (a.domain in (select split_part(lower(e.email_address::text), '@', 2) from public.email_accounts e)
                   or a.domain in (select split_part(lower(p.email::text), '@', 2) from public.profiles p)))
$$;
revoke execute on function private.is_internal_email(text) from public, anon, authenticated;

-- The customer addresses a mailbox may be searched for (service role).
--   p_customer_email null → customers on deals owned by the mailbox's owner (background sync)
--   p_customer_email set  → that one address, when the mailbox owner asks for it on a deal
-- Internal addresses are never returned.
create or replace function public.mailbox_customer_addresses(p_account_id uuid, p_customer_email text default null) returns text[]
language plpgsql security definer set search_path = '' as $$
declare v_user uuid;
begin
  if not private.is_service_role() then
    raise exception 'not allowed' using errcode = 'insufficient_privilege';
  end if;
  select user_id into v_user from public.email_accounts where id = p_account_id and status = 'connected';
  if v_user is null then return '{}'; end if;
  if p_customer_email is not null then
    return case when exists (select 1 from public.customers c where lower(c.email::text) = lower(trim(p_customer_email)))
                     and not private.is_internal_email(p_customer_email)
                then array[lower(trim(p_customer_email))] else '{}'::text[] end;
  end if;
  return coalesce((
    select array_agg(distinct lower(c.email::text))
      from public.customers c
     where c.email is not null and position('@' in c.email::text) > 0
       and exists (select 1 from public.opportunities o where o.customer_id = c.id and o.owner_id = v_user)
       and not private.is_internal_email(c.email::text)), '{}');
end $$;

-- ---------------------------------------------------------------------------
-- save_email_account: called by the sign-in callback as the user who is linking their mailbox.
-- The tokens arrive already encrypted by the server.
-- ---------------------------------------------------------------------------
create or replace function public.save_email_account(
  p_provider public.email_provider, p_email text, p_access_token_enc text, p_refresh_token_enc text, p_expires_at timestamptz
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_email text := lower(nullif(trim(p_email), ''));
begin
  if not private.is_staff() then
    raise exception 'not allowed' using errcode = 'insufficient_privilege';
  end if;
  if v_email is null or v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or p_access_token_enc is null or p_refresh_token_enc is null then
    return jsonb_build_object('ok', false, 'code', 'invalid', 'message', 'The mailbox could not be linked');
  end if;
  insert into public.email_accounts (user_id, provider, email_address, status, access_token_enc, refresh_token_enc, expires_at, last_error, synced_through)
  values (auth.uid(), p_provider, v_email, 'connected', p_access_token_enc, p_refresh_token_enc, p_expires_at, null, null)
  on conflict (user_id) do update
    set provider = excluded.provider, email_address = excluded.email_address, status = 'connected',
        access_token_enc = excluded.access_token_enc, refresh_token_enc = excluded.refresh_token_enc,
        expires_at = excluded.expires_at, last_error = null,
        -- A different mailbox starts its sync from scratch.
        synced_through = case when public.email_accounts.email_address = excluded.email_address then public.email_accounts.synced_through else null end;
  return jsonb_build_object('ok', true);
end $$;

-- ---------------------------------------------------------------------------
-- disconnect_email_account: the user unlinks their own mailbox. Stored messages stay on the deals.
-- ---------------------------------------------------------------------------
create or replace function public.disconnect_email_account() returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_staff() then
    raise exception 'not allowed' using errcode = 'insufficient_privilege';
  end if;
  update public.email_accounts
     set status = 'disconnected', access_token_enc = null, refresh_token_enc = null, expires_at = null, last_error = null
   where user_id = auth.uid();
  return jsonb_build_object('ok', true);
end $$;

-- ---------------------------------------------------------------------------
-- record_email_message (service role): stores one message if, and only if, it involves a customer.
-- Matching is by exact email address. The deal is the customer's newest open deal, else their
-- newest deal. Adds one `email` timeline entry. Returns {ok, stored, reason?}.
-- p: account_id, provider, provider_message_id, internet_message_id, thread_id, direction,
--    from_address, from_name, to_addresses[], cc_addresses[], subject, snippet, body_text,
--    has_attachments, sent_at, [opportunity_id]  (set when sent from a deal's Email tab)
-- ---------------------------------------------------------------------------
create or replace function public.record_email_message(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_account public.email_accounts%rowtype;
  v_direction public.email_direction := (p->>'direction')::public.email_direction;
  v_from text := lower(trim(p->>'from_address'));
  v_to text[] := coalesce((select array_agg(lower(trim(x))) from jsonb_array_elements_text(coalesce(p->'to_addresses', '[]'::jsonb)) x where trim(x) <> ''), '{}');
  v_cc text[] := coalesce((select array_agg(lower(trim(x))) from jsonb_array_elements_text(coalesce(p->'cc_addresses', '[]'::jsonb)) x where trim(x) <> ''), '{}');
  v_candidates text[];
  v_customer uuid;
  v_opp uuid := nullif(p->>'opportunity_id', '')::uuid;
  v_message_id text := nullif(trim(p->>'internet_message_id'), '');
  v_id uuid;
  v_subject text := left(coalesce(p->>'subject', ''), 500);
  v_actor_name text;
begin
  if not private.is_service_role() then
    raise exception 'not allowed' using errcode = 'insufficient_privilege';
  end if;
  select * into v_account from public.email_accounts where id = (p->>'account_id')::uuid;
  if not found or v_message_id is null or v_from is null or p->>'sent_at' is null then
    return jsonb_build_object('ok', false, 'stored', false, 'reason', 'invalid');
  end if;

  -- The customer is on the other side of the conversation from the mailbox owner.
  v_candidates := case when v_direction = 'inbound' then array[v_from] else v_to || v_cc end;
  if v_opp is not null then
    select o.customer_id into v_customer from public.opportunities o where o.id = v_opp;
  end if;
  if v_customer is null then
    select c.id into v_customer from public.customers c
     where c.email is not null and lower(c.email::text) = any (v_candidates)
       and not private.is_internal_email(c.email::text)   -- a colleague's address is never a customer's
     order by c.created_at limit 1;
  end if;
  if v_customer is null then
    return jsonb_build_object('ok', true, 'stored', false, 'reason', 'no_customer');
  end if;
  if v_opp is null then
    select o.id into v_opp from public.opportunities o
     where o.customer_id = v_customer
     order by (o.stage not in ('won', 'lost')) desc, o.created_at desc limit 1;
  end if;

  insert into public.email_messages (internet_message_id, account_id, provider, provider_message_id, thread_id, direction,
                                     from_address, from_name, to_addresses, cc_addresses, subject, snippet, body_text,
                                     has_attachments, sent_at, customer_id, opportunity_id)
  values (v_message_id, v_account.id, v_account.provider, p->>'provider_message_id', nullif(p->>'thread_id', ''), v_direction,
          v_from, nullif(trim(p->>'from_name'), ''), v_to, v_cc, v_subject, left(coalesce(p->>'snippet', ''), 500),
          left(coalesce(p->>'body_text', ''), 200000), coalesce((p->>'has_attachments')::boolean, false),
          (p->>'sent_at')::timestamptz, v_customer, v_opp)
  on conflict (internet_message_id) do nothing
  returning id into v_id;
  if v_id is null then
    return jsonb_build_object('ok', true, 'stored', false, 'reason', 'duplicate');
  end if;

  select full_name into v_actor_name from public.profiles where id = v_account.user_id;
  insert into public.activities (type, customer_id, opportunity_id, actor_id, summary, metadata, occurred_at)
  values ('email', v_customer, v_opp, case when v_direction = 'outbound' then v_account.user_id else null end,
          case when v_direction = 'outbound' then coalesce(v_actor_name, 'Someone') || ' emailed: ' else 'Email received: ' end
            || coalesce(nullif(v_subject, ''), '(no subject)'),
          jsonb_build_object('email_message_id', v_id, 'notes', left(coalesce(p->>'snippet', ''), 500)),
          (p->>'sent_at')::timestamptz);

  return jsonb_build_object('ok', true, 'stored', true, 'id', v_id, 'customer_id', v_customer, 'opportunity_id', v_opp);
end $$;

revoke execute on function public.save_email_account(public.email_provider, text, text, text, timestamptz),
  public.disconnect_email_account(), public.record_email_message(jsonb), public.mailbox_customer_addresses(uuid, text)
  from public, anon, authenticated;
grant execute on function public.save_email_account(public.email_provider, text, text, text, timestamptz),
  public.disconnect_email_account() to authenticated;
grant execute on function public.record_email_message(jsonb), public.mailbox_customer_addresses(uuid, text) to service_role;
