-- 0020_email_linking_hardening: fixes from the security review of 0019.
--
-- 1. save_email_account was callable by any staff user with any address and any token text, so a
--    mailbox could be "linked" without proving ownership. It is now service role only: the server
--    calls it after the provider's sign-in has returned the address.
-- 2. One address can be linked by only one user.
-- 3. Customer addresses go into mailbox searches. Only plain addresses (no spaces, quotes,
--    brackets, commas, or search operators) are ever used.

drop function public.save_email_account(public.email_provider, text, text, text, timestamptz);

-- A plain single address: local@domain.tld, nothing else.
create or replace function private.is_plain_email(p text) returns boolean
language sql immutable set search_path = '' as $$
  select coalesce(lower(trim(p)) ~ '^[a-z0-9._%+-]{1,64}@[a-z0-9-]+(\.[a-z0-9-]+)+$' and length(trim(p)) <= 254, false)
$$;
revoke execute on function private.is_plain_email(text) from public, anon, authenticated;

create unique index email_accounts_address_uidx on public.email_accounts (lower(email_address::text)) where status <> 'disconnected';

create or replace function public.save_email_account(
  p_user_id uuid, p_provider public.email_provider, p_email text, p_access_token_enc text, p_refresh_token_enc text, p_expires_at timestamptz
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_email text := lower(trim(coalesce(p_email, '')));
begin
  if not private.is_service_role() then
    raise exception 'not allowed' using errcode = 'insufficient_privilege';
  end if;
  if not exists (select 1 from public.profiles where id = p_user_id and is_active and role in ('admin', 'sales')) then
    return jsonb_build_object('ok', false, 'code', 'forbidden', 'message', 'Only admin and sales users can link a mailbox');
  end if;
  if not private.is_plain_email(v_email) or p_access_token_enc is null or p_refresh_token_enc is null then
    return jsonb_build_object('ok', false, 'code', 'invalid', 'message', 'The mailbox could not be linked');
  end if;
  if exists (select 1 from public.email_accounts where lower(email_address::text) = v_email and user_id <> p_user_id and status <> 'disconnected') then
    return jsonb_build_object('ok', false, 'code', 'in_use', 'message', 'That mailbox is already linked by another user');
  end if;
  insert into public.email_accounts (user_id, provider, email_address, status, access_token_enc, refresh_token_enc, expires_at, last_error, synced_through)
  values (p_user_id, p_provider, v_email, 'connected', p_access_token_enc, p_refresh_token_enc, p_expires_at, null, null)
  on conflict (user_id) do update
    set provider = excluded.provider, email_address = excluded.email_address, status = 'connected',
        access_token_enc = excluded.access_token_enc, refresh_token_enc = excluded.refresh_token_enc,
        expires_at = excluded.expires_at, last_error = null,
        synced_through = case when public.email_accounts.email_address = excluded.email_address then public.email_accounts.synced_through else null end;
  return jsonb_build_object('ok', true);
end $$;
revoke execute on function public.save_email_account(uuid, public.email_provider, text, text, text, timestamptz) from public, anon, authenticated;
grant execute on function public.save_email_account(uuid, public.email_provider, text, text, text, timestamptz) to service_role;

-- Only plain addresses are handed to the mailbox search.
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
    return case when private.is_plain_email(p_customer_email)
                     and exists (select 1 from public.customers c where lower(trim(c.email::text)) = lower(trim(p_customer_email)))
                     and not private.is_internal_email(p_customer_email)
                then array[lower(trim(p_customer_email))] else '{}'::text[] end;
  end if;
  return coalesce((
    select array_agg(distinct lower(trim(c.email::text)))
      from public.customers c
     where c.email is not null and private.is_plain_email(c.email::text)
       and exists (select 1 from public.opportunities o where o.customer_id = c.id and o.owner_id = v_user)
       and not private.is_internal_email(c.email::text)), '{}');
end $$;
