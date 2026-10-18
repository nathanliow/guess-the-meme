import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getShareData, verdict } from "@/lib/share";

export async function generateMetadata({ params }: PageProps<"/r/[id]">): Promise<Metadata> {
  const d = await getShareData((await params).id);
  if (!d) return {};
  const n = d.called.length;
  const title = `${d.handle}: ${n} ${n === 1 ? "coin" : "coins"} guessed correctly — #${d.rank} ${d.board}`;
  return { title, openGraph: { title }, twitter: { card: "summary_large_image", title } };
}

export default async function SharePage({ params }: PageProps<"/r/[id]">) {
  const { id } = await params;
  const d = await getShareData(id);
  if (!d) notFound();
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-4xl flex-col items-center justify-center gap-8 px-4 py-12">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={`/r/${id}/opengraph-image`}
        alt={`${d.handle}: ${verdict(d.called.length)} — ${d.called.length} coins guessed correctly, #${d.rank} ${d.board}`}
        width={1200}
        height={630}
        className="w-full rounded-2xl border border-zinc-800"
      />
      <div className="flex flex-wrap items-center justify-center gap-3">
        <Link href="/play" className="rounded-full bg-accent px-8 py-3 text-lg font-semibold text-black">
          Can you beat it? Play
        </Link>
        <Link href="/leaderboard" className="rounded-full border border-zinc-700 px-6 py-3">
          Leaderboard
        </Link>
      </div>
    </main>
  );
}
