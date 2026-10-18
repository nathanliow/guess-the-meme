import { admin, getUser, handle, HttpError } from "@/lib/supabase-admin";

export const POST = handle(async (req: Request) => {
  const user = await getUser(req);
  const { handle: h } = await req.json().catch(() => ({}));
  if (typeof h !== "string" || !/^[A-Za-z0-9_]{3,20}$/.test(h)) throw new HttpError(400, "invalid_handle");
  const { error } = await admin.from("profiles").update({ handle: h }).eq("user_id", user.id);
  if (error?.code === "23505") throw new HttpError(409, "handle_taken");
  if (error) throw error;
  return Response.json({ handle: h });
});
