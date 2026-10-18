import { admin, handle, HttpError, requireAdmin } from "@/lib/supabase-admin";

const EDITABLE = ["tier", "highlight_from", "highlight_to", "launchpad", "ticker", "status"];

export const PATCH = handle(async (req: Request, ctx: RouteContext<"/api/admin/tokens/[id]">) => {
  await requireAdmin(req);
  const { id } = await ctx.params;
  const body = await req.json().catch(() => ({}));
  const patch = Object.fromEntries(Object.entries(body).filter(([k]) => EDITABLE.includes(k)));
  if (!Object.keys(patch).length) throw new HttpError(400, "nothing_to_update");
  const { data, error } = await admin.from("tokens").update(patch).eq("id", id).select().single();
  if (error) throw new HttpError(400, error.message);
  return Response.json(data);
});
