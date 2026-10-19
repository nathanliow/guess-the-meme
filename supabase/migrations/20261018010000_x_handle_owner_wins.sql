-- The real X account owner wins its username: anyone who claimed it by hand (without that X identity)
-- goes back to their default anon_ handle when the owner links X.

create or replace function public.adopt_x_handle() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_handle text := coalesce(new.identity_data->>'user_name', new.identity_data->>'preferred_username');
begin
  if new.provider <> 'x' or v_handle !~ '^[A-Za-z0-9_]{3,20}$' then return new; end if;
  -- keep a handle the user picked themselves
  if not exists (select 1 from public.profiles where user_id = new.user_id and handle like 'anon\_%') then return new; end if;

  update public.profiles o set handle = 'anon_' || left(replace(o.user_id::text, '-', ''), 8)
   where lower(o.handle) = lower(v_handle)
     and o.user_id <> new.user_id
     and not exists (
       select 1 from auth.identities i
        where i.user_id = o.user_id and i.provider = 'x' and lower(i.identity_data->>'user_name') = lower(v_handle));

  update public.profiles p set handle = v_handle
   where p.user_id = new.user_id
     and not exists (select 1 from public.profiles o where lower(o.handle) = lower(v_handle));
  return new;
end $$;
