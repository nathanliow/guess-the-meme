import Link from "next/link";
import Board from "@/components/Board";
import { getLeaderboard, type Scope } from "@/lib/leaderboard";

export default async function Leaderboard({ searchParams }: PageProps<"/leaderboard">) {
  const scope: Scope = (await searchParams).scope === "all" ? "all" : "weekly";
  const entries = await getLeaderboard(scope);
  const tab = (s: Scope, label: string) => (
    <Link href={`?scope=${s}`} className={`rounded-full px-4 py-1.5 ${scope === s ? "bg-accent text-black" : "border border-zinc-700"}`}>
      {label}
    </Link>
  );
  return (
    <main className="mx-auto w-full max-w-4xl px-4 py-10 lg:px-8">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold">Leaderboard</h1>
        <Link href="/play" className="text-sm underline">Play</Link>
      </div>
      <div className="mb-4 flex gap-2 text-sm">
        {tab("weekly", "This week")}
        {tab("all", "All time")}
      </div>
      {scope === "weekly" && <p className="mb-2 text-xs text-zinc-500">Resets Monday 00:00 UTC</p>}
      <Board entries={entries} />
    </main>
  );
}
