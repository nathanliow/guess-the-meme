import { getUser, handle, HttpError, rpc } from "@/lib/supabase-admin";

export const POST = handle(async (req: Request) => {
  const user = await getUser(req);
  const res = await rpc<{ run_id: string; round_id: string | null }>("start_run", { p_user: user.id });
  if (!res.round_id) throw new HttpError(503, "no_tokens");
  return Response.json({ runId: res.run_id, roundId: res.round_id });
});
