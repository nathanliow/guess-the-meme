import { roundView } from "@/lib/round-view";
import { getUser, handle } from "@/lib/supabase-admin";

export const GET = handle(async (req: Request, ctx: RouteContext<"/api/rounds/[id]">) => {
  const user = await getUser(req);
  const { id } = await ctx.params;
  return Response.json(await roundView(id, user.id));
});
