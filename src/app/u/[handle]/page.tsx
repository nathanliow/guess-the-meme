import Link from "next/link";
import { notFound } from "next/navigation";
import { admin } from "@/lib/supabase-admin";

export default async function Profile({ params }: PageProps<"/u/[handle]">) {
  const { handle } = await params;
  const { data: profile } = await admin.from("profiles").select("user_id, handle").eq("handle", handle).maybeSingle();
  if (!profile) notFound();
  const { data: runs } = await admin
    .from("runs")
    .select("id, score, round_no, ended_at")
    .eq("user_id", profile.user_id)
    .eq("status", "over")
    .order("score", { ascending: false })
    .limit(10);
  return (
    <main className="mx-auto w-full max-w-4xl px-4 py-10 lg:px-8">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold">{profile.handle}</h1>
        <Link href="/leaderboard" className="text-sm underline">Leaderboard</Link>
      </div>
      <h2 className="mb-2 text-sm text-zinc-500">Best runs</h2>
      <ol className="divide-y divide-zinc-800">
        {(runs ?? []).map((r) => (
          <li key={r.id} className="flex justify-between py-3 font-mono">
            <span>{r.score.toLocaleString()} pts</span>
            <span className="text-zinc-500">round {r.round_no} · {new Date(r.ended_at!).toLocaleDateString()}</span>
          </li>
        ))}
      </ol>
    </main>
  );
}
