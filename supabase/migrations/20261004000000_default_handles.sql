-- Every player is on the leaderboard: default handle anon_<8 hex of user id>, renamable.

create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (user_id, handle)
  values (new.id, 'anon_' || left(replace(new.id::text, '-', ''), 8));
  return new;
end $$;

revoke execute on function public.handle_new_user() from public, anon, authenticated;

update public.profiles set handle = 'anon_' || left(replace(user_id::text, '-', ''), 8) where handle is null;
