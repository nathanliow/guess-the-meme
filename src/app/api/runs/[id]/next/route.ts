import { getUser, handle, rpc } from "@/lib/supabase-admin";

export const POST = handle(async (req: Request, ctx: RouteContext<"/api/runs/[id]/next">) => {
  const user = await getUser(req);
  const { id } = await ctx.params;
  const res = await rpc<{ round_id?: string; error?: string }>("next_round", { p_run: id, p_user: user.id });
  if (res.error) return Response.json({ error: res.error }, { status: 409 });
  return Response.json({ roundId: res.round_id });
});
