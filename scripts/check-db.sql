-- SQL checks for the game functions. Everything runs in one block that always raises at the end,
-- so nothing is persisted. Success = error message 'CHECK_DB_PASSED'.
-- Run: supabase db query --linked -f scripts/check-db.sql
do $$
declare
  u uuid := gen_random_uuid(); u2 uuid := gen_random_uuid();
  j jsonb; v_run uuid; v_round uuid; v_tok bigint; i int; r public.runs; rd public.rounds;
begin
  insert into auth.users (id, aud, role) values (u, 'authenticated', 'authenticated'), (u2, 'authenticated', 'authenticated');
  assert (select count(*) from public.profiles where user_id in (u, u2)) = 2, 'profile trigger';

  -- pool: 2 easy, 1 hard, 1 pending (never picked)
  insert into public.tokens (network_id, chain, address, ticker, tier, status) values
    (1, 'test', 'chk-a', 'AAA', 'easy', 'approved'),
    (1, 'test', 'chk-b', 'BBB', 'easy', 'approved'),
    (1, 'test', 'chk-c', 'CCC', 'hard', 'approved'),
    (1, 'test', 'chk-d', 'DDD', 'easy', 'pending');
  -- hide any real approved tokens from pick_token during the check
  update public.tokens set status = 'pending' where status = 'approved' and chain <> 'test';

  j := public.start_run(u);
  v_run := (j->>'run_id')::uuid; v_round := (j->>'round_id')::uuid;
  select * into rd from public.rounds where id = v_round;
  assert rd.tier = 'easy' and rd.round_no = 1, 'round 1 easy';
  assert (select ticker from public.tokens where id = rd.token_id) in ('AAA', 'BBB'), 'picks approved easy token';

  -- duplicate wrong guess → one life
  j := public.submit_guess(v_round, u, 'zzz');
  assert j->>'result' = 'wrong' and (j->>'lives')::int = 2, 'wrong costs a life';
  j := public.submit_guess(v_round, u, ' $ZZZ');
  assert (j->>'duplicate')::bool and (j->>'lives')::int = 2, 'duplicate wrong is a no-op';

  -- other user can't guess on this round
  begin
    perform public.submit_guess(v_round, u2, 'x');
    assert false, 'foreign user guessed';
  exception when raise_exception then null;
  end;

  -- can't advance while active
  assert public.next_round(v_run, u)->>'error' = 'round_active', 'next blocked while active';

  -- correct guess at t≈0 with streak 0 → 100 pts
  j := public.submit_guess(v_round, u, (select '$' || lower(ticker) from public.tokens where id = rd.token_id));
  assert j->>'result' = 'correct' and (j->>'points')::int = 100, 'correct = 100 pts, got ' || (j->>'points');
  assert (select streak from public.runs where id = v_run) = 1, 'streak +1';
  assert public.submit_guess(v_round, u, 'qqq')->>'result' = 'closed', 'solved round closed';

  -- round 2: left active past 60s → next still advances, streak reset, no life lost
  j := public.next_round(v_run, u); v_round := (j->>'round_id')::uuid;
  update public.rounds set started_at = now() - interval '61 seconds' where id = v_round;
  j := public.next_round(v_run, u);
  assert j ? 'round_id', 'next advances past expired round: ' || j::text;
  assert (select status from public.rounds where id = v_round) = 'expired', 'round expired';
  select * into r from public.runs where id = v_run;
  assert r.streak = 0 and r.lives = 2, 'expiry: streak 0, lives kept';

  -- round 3: easy pool exhausted → falls back to nearest tier (hard)
  v_round := (j->>'round_id')::uuid;
  assert (select t.ticker from public.rounds x join public.tokens t on t.id = x.token_id where x.id = v_round) = 'CCC',
    'tier fallback';

  -- decay: 30s → half; points use the round's tier (easy), not the fallback token's
  update public.rounds set started_at = now() - interval '30 seconds' where id = v_round;
  j := public.submit_guess(v_round, u, 'CCC');
  assert (j->>'points')::int = 50, 'round tier (easy) at 30s, streak 0 = 50, got ' || (j->>'points');

  -- pool exhausted → run over, score kept
  j := public.next_round(v_run, u);
  assert j->>'error' = 'run_over', 'exhausted pool ends run';
  select * into r from public.runs where id = v_run;
  assert r.status = 'over' and r.score = 150 and r.ended_at is not null, 'run over keeps score';

  -- lives out: new run, 2 more wrong (lives 3 → 0 over three guesses) → failed round, run over once
  j := public.start_run(u); v_run := (j->>'run_id')::uuid; v_round := (j->>'round_id')::uuid;
  perform public.submit_guess(v_round, u, 'w1');
  perform public.submit_guess(v_round, u, 'w2');
  j := public.submit_guess(v_round, u, 'w3');
  assert j->>'run_status' = 'over' and (j->>'lives')::int = 0, 'third wrong ends run';
  assert (select status from public.rounds where id = v_round) = 'failed', 'round failed';
  assert public.submit_guess(v_round, u, 'w4')->>'result' = 'closed', 'no guesses after run over';
  assert (select lives from public.runs where id = v_run) = 0, 'lives never negative';

  -- starting a run ends the previous active one
  j := public.start_run(u2); v_run := (j->>'run_id')::uuid;
  j := public.start_run(u2);
  assert (select status from public.runs where id = v_run) = 'over', 'new run ends old run';

  -- stale run closed
  v_run := (j->>'run_id')::uuid;
  update public.rounds set started_at = now() - interval '12 minutes' where run_id = v_run;
  perform public.close_stale_runs();
  assert (select status from public.runs where id = v_run) = 'over', 'stale run closed';

  -- leaderboard: everyone gets a default anon_ handle, renamable
  assert (select handle from public.profiles where user_id = u2) = 'anon_' || left(replace(u2::text, '-', ''), 8), 'default handle';
  assert exists (select 1 from public.leaderboard_weekly where handle like 'anon\_%'), 'anon runs on weekly board';
  update public.profiles set handle = 'chk_user' where user_id = u2;
  assert exists (select 1 from public.leaderboard_weekly where handle = 'chk_user'), 'weekly board';

  raise exception 'CHECK_DB_PASSED';
end $$;
