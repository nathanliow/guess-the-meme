import Link from "next/link";
import type { Entry } from "@/lib/leaderboard";

export default function Board({ entries, me }: { entries: Entry[]; me?: string | null }) {
  if (!entries.length) return <p className="py-8 text-center text-zinc-500">No runs yet. Be first.</p>;
  return (
    <table className="w-full text-left">
      <thead className="text-xs uppercase tracking-wide text-zinc-500">
        <tr>
          <th className="w-12 py-2 pr-4 text-right font-normal">#</th>
          <th className="py-2 font-normal">Player</th>
          <th className="py-2 pr-6 text-right font-normal">Rounds</th>
          <th className="py-2 text-right font-normal">Score</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-zinc-800">
        {entries.map((e, i) => (
          <tr key={e.handle} className={e.handle === me ? "text-accent" : ""}>
            <td className="py-3 pr-4 text-right font-mono text-zinc-500">{i + 1}</td>
            <td className="max-w-0 truncate py-3">
              <Link href={`/u/${e.handle}`} className="hover:underline">
                {e.handle}
              </Link>
            </td>
            <td className="py-3 pr-6 text-right font-mono text-zinc-400">{e.round_no}</td>
            <td className="py-3 text-right font-mono">{e.score.toLocaleString()}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
