import { getLeaderboard } from "@/lib/leaderboard";
import { handle } from "@/lib/supabase-admin";

export const GET = handle(async (req: Request) => {
  const scope = new URL(req.url).searchParams.get("scope") === "all" ? "all" : "weekly";
  return Response.json(await getLeaderboard(scope, 10));
});
