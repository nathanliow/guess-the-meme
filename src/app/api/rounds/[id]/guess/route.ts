import { getUser, handle, HttpError, rpc } from "@/lib/supabase-admin";

export const POST = handle(async (req: Request, ctx: RouteContext<"/api/rounds/[id]/guess">) => {
  const user = await getUser(req);
  const { id } = await ctx.params;
  const { value } = await req.json().catch(() => ({}));
  if (typeof value !== "string" || !value.trim() || value.length > 32) throw new HttpError(400, "invalid_guess");
  return Response.json(await rpc("submit_guess", { p_round: id, p_user: user.id, p_value: value }));
});
