-- Linking X replaces the default anon_ handle with the X username (if valid and not taken).
-- Covers both linkIdentity (anon → X) and a fresh X sign-in (profile row already made by handle_new_user).

create or replace function public.adopt_x_handle() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_handle text := coalesce(new.identity_data->>'user_name', new.identity_data->>'preferred_username');
begin
  if new.provider = 'x' and v_handle ~ '^[A-Za-z0-9_]{3,20}$' then
    update public.profiles p set handle = v_handle
     where p.user_id = new.user_id
       and p.handle like 'anon\_%'
       and not exists (select 1 from public.profiles o where lower(o.handle) = lower(v_handle));
  end if;
  return new;
end $$;

revoke execute on function public.adopt_x_handle() from public, anon, authenticated;

create trigger on_x_identity_linked
  after insert on auth.identities
  for each row execute function public.adopt_x_handle();

-- backfill accounts that linked X before this existed
update public.profiles p set handle = i.identity_data->>'user_name'
  from auth.identities i
 where i.user_id = p.user_id
   and i.provider = 'x'
   and p.handle like 'anon\_%'
   and i.identity_data->>'user_name' ~ '^[A-Za-z0-9_]{3,20}$'
   and not exists (select 1 from public.profiles o where lower(o.handle) = lower(i.identity_data->>'user_name'));
