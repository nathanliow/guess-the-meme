import { admin, handle, requireAdmin } from "@/lib/supabase-admin";

export const GET = handle(async (req: Request) => {
  await requireAdmin(req);
  const status = new URL(req.url).searchParams.get("status") ?? "pending";
  const { data, error } = await admin
    .from("tokens")
    .select("*, candles(series, resolution, bars)")
    .eq("status", status)
    .order("peak_mcap", { ascending: false, nullsFirst: false })
    .limit(50);
  if (error) throw error;
  const paths = data.flatMap((t) => [t.logo_path, t.logo_blur_path]).filter(Boolean);
  const { data: urls } = paths.length
    ? await admin.storage.from("logos").createSignedUrls(paths, 3600)
    : { data: [] };
  const url = (p: string | null) => urls?.find((u) => u.path === p)?.signedUrl ?? null;
  return Response.json(data.map((t) => ({ ...t, logo_url: url(t.logo_path), logo_blur_url: url(t.logo_blur_path) })));
});
