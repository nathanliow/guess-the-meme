"use client";
import { useEffect, useState } from "react";
import AuthButton from "@/components/AuthButton";
import Chart from "@/components/Chart";
import { ApiError, api } from "@/lib/client";
import { type Bar, sliceWindow } from "@/lib/game";
import { supabase } from "@/lib/supabase";

type Token = {
  id: number;
  chain: string;
  address: string;
  name: string | null;
  ticker: string | null;
  launchpad: string | null;
  peak_mcap: number | null;
  pct_run: number | null;
  tier: string | null;
  highlight_from: number | null;
  highlight_to: number | null;
  logo_url: string | null;
  logo_blur_url: string | null;
  candles: { series: string; resolution: string; bars: Bar[] }[];
};

const STATUSES = ["pending", "approved", "rejected"] as const;

export default function Admin() {
  const [status, setStatus] = useState<(typeof STATUSES)[number]>("pending");
  const [tokens, setTokens] = useState<Token[] | null>(null);
  const [denied, setDenied] = useState<string | null>(null);

  useEffect(() => {
    api<Token[]>(`/api/admin/tokens?status=${status}`)
      .then(setTokens)
      .catch(async (e) => {
        if (e instanceof ApiError && e.status === 403) {
          const { data } = await supabase.auth.getUser();
          setDenied(data.user?.id ?? "?");
        } else throw e;
      });
  }, [status]);

  const save = async (id: number, patch: Partial<Token> & { status?: string }) => {
    const updated = await api<Token>(`/api/admin/tokens/${id}`, { method: "PATCH", body: patch });
    setTokens((ts) => (patch.status && patch.status !== status ? ts!.filter((t) => t.id !== id) : ts!.map((t) => (t.id === id ? { ...t, ...updated } : t))));
  };

  if (denied) {
    return (
      <main className="mx-auto max-w-xl space-y-4 px-4 py-12">
        <p>Not an admin. Sign in with X, then add your user id to <code>ADMIN_USER_IDS</code>:</p>
        <code className="block rounded bg-zinc-900 p-3">{denied}</code>
        <AuthButton />
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-5xl px-4 py-8">
      <div className="mb-6 flex items-center gap-2">
        <h1 className="mr-auto text-2xl font-bold">Token review</h1>
        {STATUSES.map((s) => (
          <button key={s} onClick={() => {
              setTokens(null);
              setStatus(s);
            }} className={`rounded-full px-4 py-1.5 text-sm ${s === status ? "bg-accent text-black" : "border border-zinc-700"}`}>
            {s}
          </button>
        ))}
      </div>
      {!tokens ? <p className="text-zinc-500">Loading…</p> : !tokens.length ? <p className="text-zinc-500">Nothing here.</p> : null}
      <div className="space-y-6">
        {tokens?.map((t) => <TokenCard key={t.id} token={t} onSave={(p) => save(t.id, p)} />)}
      </div>
    </main>
  );
}

function TokenCard({ token: t, onSave }: { token: Token; onSave: (patch: Record<string, unknown>) => Promise<void> }) {
  const full = t.candles.find((c) => c.series === "full");
  const detail = t.candles.find((c) => c.series === "detail");
  const dBars = detail?.bars ?? full?.bars ?? [];
  const idx = (ts: number | null, fallback: number) => {
    const i = dBars.findIndex((b) => b[0] >= (ts ?? Infinity));
    return i < 0 ? fallback : i;
  };
  const [hl, setHl] = useState<[number, number]>([idx(t.highlight_from, 0), idx(t.highlight_to, dBars.length - 1)]);
  const [tier, setTier] = useState(t.tier ?? "");
  const [launchpad, setLaunchpad] = useState(t.launchpad ?? "");
  const nonLatin = !!t.ticker && !/^[\x21-\x7E]+$/.test(t.ticker);
  const ready = !!full && !!tier && dBars.length > 0;
  const highlight = dBars.length ? { from: dBars[hl[0]][0], to: dBars[hl[1]][0] } : { from: 0, to: 0 };

  const patch = (extra: Record<string, unknown> = {}) =>
    onSave({ tier: tier || null, launchpad: launchpad || null, highlight_from: highlight.from, highlight_to: highlight.to, ...extra });

  return (
    <article className="rounded-2xl border border-zinc-800 p-4">
      <header className="mb-3 flex flex-wrap items-center gap-3">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {t.logo_url && <img src={t.logo_url} alt="" className="size-10 rounded-lg" />}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {t.logo_blur_url && <img src={t.logo_blur_url} alt="" className="size-10 rounded-lg" />}
        <div className="mr-auto">
          <p className="font-bold">
            ${t.ticker} <span className="font-normal text-zinc-400">{t.name}</span>
            {nonLatin && <span className="ml-2 text-xs text-danger">non-Latin ticker</span>}
          </p>
          <p className="text-xs text-zinc-500">
            {t.chain} · peak {t.peak_mcap ? `$${(t.peak_mcap / 1e6).toFixed(1)}M` : "—"} · {t.address}
          </p>
        </div>
        <select value={tier} onChange={(e) => setTier(e.target.value)} className="rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-sm">
          <option value="">tier…</option>
          {["easy", "medium", "hard", "degen"].map((x) => (
            <option key={x}>{x}</option>
          ))}
        </select>
        <input value={launchpad} onChange={(e) => setLaunchpad(e.target.value)} placeholder="launchpad" className="w-32 rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-sm" />
      </header>

      {full && dBars.length ? (
        <>
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            {[0, 1, 2, 3].map((s) => (
              <div key={s} className="rounded-lg bg-zinc-950 p-1">
                <p className="px-1 text-xs text-zinc-500">{["0s highlight", "5s · 3×", "10s · 6×", "15s · full"][s]}</p>
                <Chart bars={sliceWindow(dBars, full.bars, highlight, s)} className="h-32 w-full" />
              </div>
            ))}
          </div>
          <label className="mt-3 block text-xs text-zinc-500">
            Highlight (bars {hl[0]}–{hl[1]} of {dBars.length}, {detail?.resolution ?? full.resolution})
            <input type="range" min={0} max={hl[1]} value={hl[0]} onChange={(e) => setHl([+e.target.value, hl[1]])} className="block w-full" />
            <input type="range" min={hl[0]} max={dBars.length - 1} value={hl[1]} onChange={(e) => setHl([hl[0], +e.target.value])} className="block w-full" />
          </label>
        </>
      ) : (
        <p className="text-sm text-danger">No candles — run `npm run ingest -- all`.</p>
      )}


      <div className="mt-3 flex gap-2">
        <button disabled={!ready} onClick={() => patch({ status: "approved" })} className="rounded-full bg-accent px-4 py-1.5 text-sm font-semibold text-black disabled:opacity-40">
          Approve
        </button>
        <button onClick={() => patch()} className="rounded-full border border-zinc-700 px-4 py-1.5 text-sm">
          Save
        </button>
        <button onClick={() => onSave({ status: "rejected" })} className="rounded-full border border-danger px-4 py-1.5 text-sm text-danger">
          Reject
        </button>
      </div>
    </article>
  );
}
