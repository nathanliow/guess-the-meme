import Link from "next/link";
import AuthButton from "@/components/AuthButton";
import Board from "@/components/Board";
import { getLeaderboard } from "@/lib/leaderboard";

export const dynamic = "force-dynamic";

export default async function Home() {
  const top = await getLeaderboard("weekly", 5);
  return (
    <main className="mx-auto grid min-h-dvh w-full max-w-6xl content-center gap-12 px-4 py-12 lg:grid-cols-[1.2fr_1fr] lg:px-8">
      <div className="flex justify-end lg:col-span-2">
        <AuthButton />
      </div>
      <section className="space-y-6">
        <h1 className="text-5xl font-bold tracking-tight lg:text-7xl">
          Guess the <span className="text-accent">meme</span>.
        </h1>
        <Link href="/play" className="inline-block rounded-full bg-accent px-10 py-4 text-lg font-semibold text-black">
          Play
        </Link>
      </section>
      <section>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="font-semibold">This week</h2>
          <Link href="/leaderboard" className="text-sm underline">Full leaderboard</Link>
        </div>
        <Board entries={top} />
      </section>
    </main>
  );
}
