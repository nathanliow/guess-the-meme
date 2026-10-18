-- Guess the Meme: schema, RLS, game functions.
-- Clients never read tokens/candles/runs/rounds/guesses directly; route handlers use the service role.

create type public.tier as enum ('easy', 'medium', 'hard', 'degen');

-- ───────────── tables ─────────────

create table public.tokens (
  id bigint generated always as identity primary key,
  network_id int not null,
  chain text not null,
  address text not null,
  name text,
  ticker text,
  launchpad text,
  description text,
  description_redacted text,
  logo_path text,
  logo_blur_path text,
  supply numeric,
  launch_at timestamptz,
  full_from bigint,          -- optional manual candle range (unix s) for the `full` series
  full_to bigint,
  peak_mcap numeric,
  launch_mcap numeric,
  pct_run numeric,
  highlight_from bigint,     -- unix s, inside the `detail` series
  highlight_to bigint,
  tier public.tier,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  solve_count int not null default 0,
  seen_count int not null default 0,
  created_at timestamptz not null default now(),
  unique (network_id, address)
);
create index tokens_pick_idx on public.tokens (status, tier);

create table public.candles (
  token_id bigint not null references public.tokens on delete cascade,
  series text not null check (series in ('full', 'detail')),
  resolution text not null,
  bars jsonb not null,       -- [[t,o,h,l,c], …], t in unix s
  primary key (token_id, series)
);

create table public.profiles (
  user_id uuid primary key references auth.users on delete cascade,
  handle text check (handle ~ '^[A-Za-z0-9_]{3,20}$'),
  created_at timestamptz not null default now()
);
create unique index profiles_handle_idx on public.profiles (lower(handle));

create table public.runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  score int not null default 0,
  lives int not null default 3,
  round_no int not null default 0,
  streak int not null default 0,
  status text not null default 'active' check (status in ('active', 'over')),
  started_at timestamptz not null default now(),
  ended_at timestamptz
);
create index runs_board_idx on public.runs (status, ended_at);
create index runs_user_idx on public.runs (user_id, score desc);
create unique index runs_one_active_idx on public.runs (user_id) where status = 'active';

create table public.rounds (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.runs on delete cascade,
  token_id bigint not null references public.tokens,
  tier public.tier not null,
  round_no int not null,
  started_at timestamptz not null default now(),
  solved_at timestamptz,
  points int not null default 0,
  status text not null default 'active' check (status in ('active', 'solved', 'expired', 'failed')),
  unique (run_id, round_no)
);

create table public.guesses (
  id bigint generated always as identity primary key,
  round_id uuid not null references public.rounds on delete cascade,
  value text not null,
  correct boolean not null,
  created_at timestamptz not null default now(),
  unique (round_id, value)
);

-- ───────────── RLS ─────────────

alter table public.tokens enable row level security;
alter table public.candles enable row level security;
alter table public.profiles enable row level security;
alter table public.runs enable row level security;
alter table public.rounds enable row level security;
alter table public.guesses enable row level security;

create policy "profiles are public" on public.profiles for select using (true);

-- ───────────── profile on signup ─────────────

create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (user_id) values (new.id);
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ───────────── helpers ─────────────

-- Must match normalizeTicker() in src/lib/game.ts.
create function public.normalize_ticker(v text) returns text
language sql immutable as $$
  select upper(regexp_replace(regexp_replace(trim(v), '^\$+', ''), '\s', '', 'g'))
$$;

create function public.tier_for_round(n int) returns public.tier
language sql immutable as $$
  select case when n <= 5 then 'easy' when n <= 12 then 'medium' when n <= 20 then 'hard' else 'degen' end::public.tier
$$;

-- Mirrors TIER_BASE in src/lib/game.ts.
create function public.tier_base(t public.tier) returns int
language sql immutable as $$
  select case t when 'easy' then 100 when 'medium' then 250 when 'hard' then 500 else 1000 end
$$;

-- The single expiry path: active round past 60s → expired, streak reset. No life lost.
-- Lock order everywhere: run, then round.
create function public.expire_if_due(p_round uuid) returns void
language plpgsql as $$
declare v_run uuid;
begin
  select run_id into v_run from public.rounds where id = p_round;
  perform 1 from public.runs where id = v_run for update;
  update public.rounds set status = 'expired'
   where id = p_round and status = 'active' and now() - started_at >= interval '60 seconds';
  if found then
    update public.runs set streak = 0 where id = v_run;
  end if;
end $$;

-- Random approved token unused in this run; nearest tier (harder first on ties) if the tier is empty.
create function public.pick_token(p_run uuid, p_tier public.tier) returns bigint
language sql as $$
  select t.id from public.tokens t
   where t.status = 'approved' and t.tier is not null
     and not exists (select 1 from public.rounds r where r.run_id = p_run and r.token_id = t.id)
   order by abs(array_position(enum_range(null::public.tier), t.tier) - array_position(enum_range(null::public.tier), p_tier)),
            t.tier desc, random()
   limit 1
$$;

-- Caller must hold the run lock. Returns the new round id, or null (pool exhausted → run over).
create function public.start_round(p_run uuid) returns uuid
language plpgsql as $$
declare v_no int; v_tier public.tier; v_token bigint; v_round uuid;
begin
  select round_no + 1 into v_no from public.runs where id = p_run;
  v_tier := public.tier_for_round(v_no);
  v_token := public.pick_token(p_run, v_tier);
  if v_token is null then
    update public.runs set status = 'over', ended_at = now() where id = p_run;
    return null;
  end if;
  update public.runs set round_no = v_no where id = p_run;
  insert into public.rounds (run_id, token_id, tier, round_no) values (p_run, v_token, v_tier, v_no)
  returning id into v_round;
  update public.tokens set seen_count = seen_count + 1 where id = v_token;
  return v_round;
end $$;

-- Abandoned runs: latest round started > 70s + 10min ago → over (score counts).
create function public.close_stale_runs() returns void
language sql as $$
  update public.runs ru set status = 'over', ended_at = now()
   where ru.status = 'active'
     and coalesce((select max(r.started_at) from public.rounds r where r.run_id = ru.id), ru.started_at)
         < now() - interval '70 seconds' - interval '10 minutes'
$$;

-- ───────────── game API (called only by route handlers) ─────────────

create function public.start_run(p_user uuid) returns jsonb
language plpgsql as $$
declare v_run uuid; v_round uuid;
begin
  perform public.close_stale_runs();
  perform 1 from public.runs where user_id = p_user and status = 'active' for update;
  update public.rounds set status = 'expired'
   where status = 'active' and run_id in (select id from public.runs where user_id = p_user and status = 'active');
  update public.runs set status = 'over', ended_at = now() where user_id = p_user and status = 'active';
  insert into public.runs (user_id) values (p_user) returning id into v_run;
  v_round := public.start_round(v_run);
  return jsonb_build_object('run_id', v_run, 'round_id', v_round);
end $$;

create function public.next_round(p_run uuid, p_user uuid) returns jsonb
language plpgsql as $$
declare v_run public.runs; v_cur public.rounds; v_round uuid;
begin
  select * into v_run from public.runs where id = p_run for update;
  if not found or v_run.user_id <> p_user then raise exception 'not_found'; end if;
  if v_run.status <> 'active' then return jsonb_build_object('error', 'run_over'); end if;
  select * into v_cur from public.rounds where run_id = p_run order by round_no desc limit 1;
  if found then
    perform public.expire_if_due(v_cur.id);
    select * into v_cur from public.rounds where id = v_cur.id;
    if v_cur.status = 'active' then return jsonb_build_object('error', 'round_active'); end if;
  end if;
  v_round := public.start_round(p_run);
  if v_round is null then return jsonb_build_object('error', 'run_over'); end if;
  return jsonb_build_object('round_id', v_round);
end $$;

create function public.submit_guess(p_round uuid, p_user uuid, p_value text) returns jsonb
language plpgsql as $$
declare
  v_round public.rounds; v_run public.runs; v_prev public.guesses;
  v_value text := public.normalize_ticker(p_value);
  v_correct boolean; v_points int := 0;
begin
  select * into v_round from public.rounds where id = p_round;
  if not found then raise exception 'not_found'; end if;
  -- lock order: run, then round (same as next_round)
  select * into v_run from public.runs where id = v_round.run_id for update;
  if v_run.user_id <> p_user then raise exception 'not_found'; end if;
  perform 1 from public.rounds where id = p_round for update;
  perform public.expire_if_due(p_round);
  select * into v_round from public.rounds where id = p_round;
  select * into v_run from public.runs where id = v_round.run_id;

  if v_round.status <> 'active' or v_run.status <> 'active' then
    return jsonb_build_object('result', 'closed', 'lives', v_run.lives, 'score', v_run.score);
  end if;
  if v_value = '' then
    return jsonb_build_object('result', 'invalid', 'lives', v_run.lives, 'score', v_run.score);
  end if;

  -- double-submit of the same guess: no-op
  select * into v_prev from public.guesses where round_id = p_round and value = v_value;
  if found then
    return jsonb_build_object('result', case when v_prev.correct then 'correct' else 'wrong' end,
      'duplicate', true, 'lives', v_run.lives, 'score', v_run.score);
  end if;

  select public.normalize_ticker(ticker) = v_value into v_correct from public.tokens where id = v_round.token_id;
  insert into public.guesses (round_id, value, correct) values (p_round, v_value, v_correct);

  if v_correct then
    v_points := round(public.tier_base(v_round.tier)
      * greatest(0, 60 - extract(epoch from now() - v_round.started_at)) / 60
      * least(1 + 0.1 * v_run.streak, 2));
    update public.rounds set status = 'solved', solved_at = now(), points = v_points where id = p_round;
    update public.runs set score = score + v_points, streak = streak + 1 where id = v_run.id
      returning * into v_run;
    update public.tokens set solve_count = solve_count + 1 where id = v_round.token_id;
  else
    update public.runs set lives = lives - 1, streak = 0,
      status = case when lives - 1 <= 0 then 'over' else status end,
      ended_at = case when lives - 1 <= 0 then now() else ended_at end
     where id = v_run.id returning * into v_run;
    if v_run.status = 'over' then
      update public.rounds set status = 'failed' where id = p_round;
    end if;
  end if;

  return jsonb_build_object('result', case when v_correct then 'correct' else 'wrong' end,
    'points', v_points, 'lives', v_run.lives, 'score', v_run.score, 'run_status', v_run.status);
end $$;

-- Functions are server-only: no RPC from browsers.
revoke execute on all functions in schema public from public, anon, authenticated;

-- ───────────── leaderboards (UTC ISO weeks) ─────────────

create view public.leaderboard_all_time with (security_invoker = on) as
select distinct on (r.user_id) p.handle, r.score, r.round_no, r.ended_at, r.id as run_id
  from public.runs r join public.profiles p on p.user_id = r.user_id
 where r.status = 'over' and p.handle is not null
 order by r.user_id, r.score desc, r.ended_at;

create view public.leaderboard_weekly with (security_invoker = on) as
select distinct on (r.user_id) p.handle, r.score, r.round_no, r.ended_at, r.id as run_id
  from public.runs r join public.profiles p on p.user_id = r.user_id
 where r.status = 'over' and p.handle is not null
   and r.ended_at >= date_trunc('week', now() at time zone 'utc') at time zone 'utc'
 order by r.user_id, r.score desc, r.ended_at;

revoke all on public.leaderboard_all_time, public.leaderboard_weekly from anon, authenticated;

-- ───────────── storage ─────────────

insert into storage.buckets (id, name, public) values ('logos', 'logos', false);
