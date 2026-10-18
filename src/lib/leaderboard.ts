import { admin, rpc } from "./supabase-admin";

export type Scope = "weekly" | "all";
export type Entry = { handle: string; score: number; round_no: number; ended_at: string };

export async function getLeaderboard(scope: Scope, limit = 100): Promise<Entry[]> {
  await rpc("close_stale_runs", {});
  const { data, error } = await admin
    .from(scope === "weekly" ? "leaderboard_weekly" : "leaderboard_all_time")
    .select("handle, score, round_no, ended_at")
    .order("score", { ascending: false })
    .order("ended_at")
    .limit(limit);
  if (error) throw error;
  return data;
}
