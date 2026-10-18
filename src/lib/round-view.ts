import { admin, HttpError, rpc } from "./supabase-admin";
import {
  type Bar,
  type Tier,
  ROUND_MS,
  STAGES,
  nextStageAt,
  sliceWindow,
  stagesAt,
  tickerPattern,
} from "./game";

const signed = async (path: string | null) =>
  path ? (await admin.storage.from("logos").createSignedUrl(path, 600)).data?.signedUrl ?? null : null;

/** Everything the player may see for a round right now — and nothing they may not. */
export async function roundView(roundId: string, userId: string) {
  await rpc("expire_if_due", { p_round: roundId });

  const { data: round } = await admin
    .from("rounds")
    .select("id, run_id, token_id, tier, round_no, started_at, points, status, runs!inner(user_id, lives, score, streak, status)")
    .eq("id", roundId)
    .maybeSingle();
  const run = round?.runs as unknown as { user_id: string; lives: number; score: number; streak: number; status: string };
  if (!round || run.user_id !== userId) throw new HttpError(404, "not_found");

  const tier = round.tier as Tier;
  const ended = round.status !== "active";
  const elapsedMs = Math.min(ROUND_MS, Date.now() - Date.parse(round.started_at));
  const unlocked = new Set(ended ? STAGES.map((s) => s.key) : stagesAt(elapsedMs, tier));

  const [{ data: token }, { data: candles }, { data: guesses }] = await Promise.all([
    admin.from("tokens").select("*").eq("id", round.token_id).single(),
    admin.from("candles").select("series, bars").eq("token_id", round.token_id),
    admin.from("guesses").select("value, correct").eq("round_id", roundId).order("created_at"),
  ]);
  if (!token) throw new HttpError(500, "token_missing");
  const full = (candles?.find((c) => c.series === "full")?.bars ?? []) as Bar[];
  const detail = (candles?.find((c) => c.series === "detail")?.bars ?? full) as Bar[];

  const stage = (["chart0", "chart1", "chart2", "chart3"] as const).filter((k) => unlocked.has(k)).length - 1;
  const chart = ended ? full : sliceWindow(detail, full, { from: token.highlight_from, to: token.highlight_to }, stage);

  return {
    round: {
      id: round.id,
      runId: round.run_id,
      roundNo: round.round_no,
      tier,
      status: round.status,
      points: round.points,
      elapsedMs,
      nextStageAtMs: ended ? null : nextStageAt(elapsedMs, tier),
    },
    run: { lives: run.lives, score: run.score, streak: run.streak, status: run.status },
    clues: {
      chart,
      chartStage: stage,
      supply: token.supply == null ? null : Number(token.supply), // for the price ⇄ market-cap toggle
      chain: unlocked.has("chain") ? token.chain : null,
      launchpad: unlocked.has("launchpad") ? (token.launchpad ?? "None") : null,
      logoBlurUrl: unlocked.has("logoBlur") ? await signed(token.logo_blur_path) : null,
      logoUrl: unlocked.has("logo") && (ended || tier !== "degen") ? await signed(token.logo_path) : null,
      pattern: unlocked.has("pattern") && !ended && tier !== "degen" ? tickerPattern(token.ticker) : null,
    },
    guesses: guesses ?? [],
    answer: ended
      ? {
          ticker: token.ticker,
          name: token.name,
          chain: token.chain,
          address: token.address,
          launchpad: token.launchpad,
          logoUrl: await signed(token.logo_path),
          peakMcap: token.peak_mcap,
          pctRun: token.pct_run,
          launchAt: token.launch_at,
        }
      : null,
  };
}

export type RoundView = Awaited<ReturnType<typeof roundView>>;
