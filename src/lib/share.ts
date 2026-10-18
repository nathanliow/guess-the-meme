import type { Bar } from "./game";
import { admin } from "./supabase-admin";

/** Badge for how many tokens a run called. */
export function verdict(n: number) {
  if (n === 0) return "Rugged by the charts";
  if (n <= 2) return "Paper Hands";
  if (n <= 5) return "Chart Curious";
  if (n <= 9) return "Degen Detective";
  if (n <= 14) return "Chart Whisperer";
  return "Memecoin Oracle";
}

/** What a finished run's share card shows: placement + tokens called. No rounds, no score. */
export async function getShareData(runId: string) {
  const { data: run } = await admin.from("runs").select("id, user_id, score, status, ended_at").eq("id", runId).maybeSingle();
  if (!run || run.status !== "over") return null;

  const [{ data: profile }, { data: rounds }] = await Promise.all([
    admin.from("profiles").select("handle").eq("user_id", run.user_id).single(),
    admin
      .from("rounds")
      .select("status, started_at, solved_at, round_no, tokens(id, ticker, logo_path)")
      .eq("run_id", runId)
      .order("round_no"),
  ]);
  const handle = profile?.handle ?? "anon";
  type Tok = { id: number; ticker: string; logo_path: string | null };
  const all = (rounds ?? []).map((r) => ({ ...r, token: r.tokens as unknown as Tok }));
  const solved = all.filter((r) => r.status === "solved");

  // placement: weekly board if the run ended this (UTC ISO) week, else all-time
  const now = new Date();
  const monday = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - ((now.getUTCDay() + 6) % 7));
  const weekly = Date.parse(run.ended_at!) >= monday;
  const { count } = await admin
    .from(weekly ? "leaderboard_weekly" : "leaderboard_all_time")
    .select("handle", { count: "exact", head: true })
    .gt("score", run.score)
    .neq("handle", handle);
  const rank = (count ?? 0) + 1;

  const fastest = solved.reduce<(typeof solved)[number] | null>(
    (best, r) => (!best || Date.parse(r.solved_at!) - Date.parse(r.started_at) < Date.parse(best.solved_at!) - Date.parse(best.started_at) ? r : best),
    null,
  );
  // the one that ended the run — shown when nothing was called
  const nemesis = all.at(-1)?.token ?? null;
  const feature = fastest?.token ?? nemesis;

  const paths = [...solved.map((r) => r.token.logo_path), nemesis?.logo_path].filter((p): p is string => !!p);
  const { data: signed } = paths.length ? await admin.storage.from("logos").createSignedUrls(paths, 600) : { data: [] };
  const logo = (p: string | null) => signed?.find((s) => s.path === p)?.signedUrl ?? null;

  let spark: number[] = [];
  if (feature) {
    const { data: c } = await admin.from("candles").select("bars").eq("token_id", feature.id).eq("series", "full").maybeSingle();
    const bars = (c?.bars ?? []) as Bar[];
    const step = Math.max(1, Math.floor(bars.length / 80));
    spark = bars.filter((_, i) => i % step === 0).map((b) => b[4]);
  }

  return {
    handle,
    rank,
    board: weekly ? "this week" : "all time",
    called: solved.map((r) => ({ ticker: r.token.ticker, logo: logo(r.token.logo_path) })),
    fastest: fastest ? { ticker: fastest.token.ticker, secs: (Date.parse(fastest.solved_at!) - Date.parse(fastest.started_at)) / 1000 } : null,
    nemesis: solved.length ? null : nemesis && { ticker: nemesis.ticker, logo: logo(nemesis.logo_path) },
    spark,
  };
}

export type ShareData = NonNullable<Awaited<ReturnType<typeof getShareData>>>;
