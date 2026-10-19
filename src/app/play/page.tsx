"use client";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import AuthButton from "@/components/AuthButton";
import Board from "@/components/Board";
import Chart from "@/components/Chart";
import { ApiError, api } from "@/lib/client";
import { ROUND_MS, STAGES, type Tier, scoreFor } from "@/lib/game";
import type { Entry } from "@/lib/leaderboard";
import type { RoundView } from "@/lib/round-view";
import { supabase } from "@/lib/supabase";

type GuessResult = {
  result: "correct" | "wrong" | "closed" | "invalid";
  duplicate?: boolean;
  lives: number;
  score: number;
  run_status?: string;
};

const REVEAL_MS = 5_000;
const LABELS: Partial<Record<(typeof STAGES)[number]["key"], string>> = {
  chart3: "full chart",
  chain: "chain",
  launchpad: "launchpad",
  logoBlur: "blurred logo",
  logo: "logo",
  pattern: "ticker pattern",
};
const fmtUsd = (n: number | null) =>
  n == null ? "—" : n >= 1e9 ? `$${(n / 1e9).toFixed(2)}B` : n >= 1e6 ? `$${(n / 1e6).toFixed(1)}M` : `$${(n / 1e3).toFixed(0)}K`;

export default function Play() {
  const [runId, setRunId] = useState<string | null>(null);
  const [view, setView] = useState<RoundView | null>(null);
  const [now, setNow] = useState(0);
  const [anchor, setAnchor] = useState(0); // performance.now() at round start, from server elapsedMs
  const [revealAt, setRevealAt] = useState<number | null>(null);
  const [guess, setGuess] = useState("");
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState<{ text: string; bad: boolean } | null>(null);
  const [shake, setShake] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [axis, setAxis] = useState<"price" | "mcap">("price");
  const stageTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const loadRound = useCallback(async (roundId: string) => {
    clearTimeout(stageTimer.current);
    const v = await api<RoundView>(`/api/rounds/${roundId}`);
    const t = performance.now();
    setAnchor(t - v.round.elapsedMs);
    setRevealAt(v.round.status === "active" ? null : t);
    setView(v);
    if (v.round.nextStageAtMs != null) {
      stageTimer.current = setTimeout(() => loadRound(roundId).catch(onError), v.round.nextStageAtMs - v.round.elapsedMs + 100);
    }
  }, []);

  function onError(e: unknown) {
    setError(
      e instanceof ApiError && e.message === "no_tokens" ? "No approved tokens yet — check back soon." : "Something went wrong. Try again.",
    );
  }

  async function start() {
    setError(null);
    setFlash(null);
    setGuess("");
    setBusy(true);
    try {
      const r = await api<{ runId: string; roundId: string }>("/api/runs", { method: "POST" });
      setRunId(r.runId);
      await loadRound(r.roundId);
    } catch (e) {
      onError(e);
    } finally {
      setBusy(false);
    }
  }

  // one advance per round: the button and the auto-advance can both fire
  const advancing = useRef<string | null>(null);
  const next = useCallback(async (fromRound: string) => {
    if (!runId || advancing.current === fromRound) return;
    advancing.current = fromRound;
    try {
      const r = await api<{ roundId: string }>(`/api/runs/${runId}/next`, { method: "POST" });
      setFlash(null);
      setGuess("");
      await loadRound(r.roundId);
    } catch (e) {
      if (e instanceof ApiError && e.message === "run_over") setView((v) => v && { ...v, run: { ...v.run, status: "over" } });
      else {
        advancing.current = null;
        onError(e);
      }
    }
  }, [runId, loadRound]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!view || busy || !guess.trim()) return;
    setBusy(true);
    try {
      const r = await api<GuessResult>(`/api/rounds/${view.round.id}/guess`, { method: "POST", body: { value: guess } });
      if (r.result === "correct") setFlash({ text: "Correct!", bad: false });
      else if (r.result === "wrong") {
        setFlash({ text: r.duplicate ? "Already guessed" : `Nope — ${r.lives} ${r.lives === 1 ? "life" : "lives"} left`, bad: true });
        setShake((n) => n + 1);
        setGuess("");
      }
      if (r.result !== "wrong" || r.run_status === "over") await loadRound(view.round.id);
      else setView((v) => v && { ...v, run: { ...v.run, lives: r.lives } });
    } catch (e) {
      onError(e);
    } finally {
      setBusy(false);
    }
  }

  // clock (display only — the server decides what's unlocked)
  useEffect(() => {
    const id = setInterval(() => setNow(performance.now()), 100);
    return () => {
      clearInterval(id);
      clearTimeout(stageTimer.current);
    };
  }, []);

  const elapsed = Math.min(ROUND_MS, Math.max(0, now - anchor));
  const ended = view && view.round.status !== "active";
  const runOver = view?.run.status === "over";
  const nextIn = revealAt != null && !runOver ? Math.max(0, REVEAL_MS - (now - revealAt)) : null;

  // auto-advance once the reveal card has shown for REVEAL_MS
  useEffect(() => {
    if (nextIn !== 0 || !view || advancing.current === view.round.id) return;
    next(view.round.id);
  }, [nextIn, view, next]);

  if (!view) {
    return (
      <main className="mx-auto flex min-h-dvh max-w-xl flex-col items-center justify-center gap-6 px-4 text-center">
        <h1 className="text-4xl font-bold tracking-tight">Guess the ticker</h1>
        <p className="text-zinc-400">60 seconds per chart. Clues unlock as time runs. Wrong guess costs a life — you have 3.</p>
        <button
          onClick={start}
          disabled={busy}
          className="rounded-full bg-accent px-10 py-4 text-lg font-semibold text-black disabled:opacity-50"
        >
          {busy ? "Loading…" : "Start run"}
        </button>
        {error && <p className="text-danger">{error}</p>}
        <div className="flex items-center gap-4 text-sm">
          <Link href="/leaderboard" className="underline">
            Leaderboard
          </Link>
          <AuthButton />
        </div>
      </main>
    );
  }

  const { round, run, clues } = view;
  const tier = round.tier as Tier;
  const worth = ended ? round.points : scoreFor(tier, elapsed, run.streak);
  const secsLeft = Math.ceil((ROUND_MS - elapsed) / 1000);
  const markers = STAGES.filter((s) => LABELS[s.key] && (tier !== "degen" || (s.key !== "logo" && s.key !== "pattern")));

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-7xl flex-col gap-3 px-4 pb-28 pt-4 lg:px-8">
      <header className="flex items-center justify-between text-sm">
        <span className="font-mono text-zinc-400">
          Round {round.roundNo} · <span className="uppercase">{tier}</span>
        </span>
        <span role="img" aria-label={`${run.lives} of 3 lives`} className="flex gap-1">
          {[0, 1, 2].map((i) => (
            <Heart key={i} full={i < run.lives} />
          ))}
        </span>
        <span className="font-mono">{run.score.toLocaleString()} pts</span>
      </header>

      {/* timer with reveal markers */}
      <div className="relative h-2 rounded-full bg-zinc-800">
        <div
          className="h-full rounded-full bg-accent transition-[width] duration-100"
          style={{ width: `${((ended ? ROUND_MS : elapsed) / ROUND_MS) * 100}%` }}
        />
        {markers.map((s) => (
          <span
            key={s.key}
            title={`${LABELS[s.key]} at ${s.at / 1000}s`}
            className="absolute top-0 h-2 w-0.5 bg-zinc-500"
            style={{ left: `${(s.at / ROUND_MS) * 100}%` }}
          />
        ))}
      </div>
      <div className="flex justify-between font-mono text-xs text-zinc-500">
        <span>{ended ? "round over" : `${secsLeft}s`}</span>
        <span className={ended ? "" : "text-accent"}>{ended ? `+${round.points}` : `worth ${worth}`}</span>
      </div>

      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_320px]">
        <section className="relative rounded-2xl border border-zinc-800 bg-zinc-950 p-2">
          <div className="absolute left-3 top-3 z-10 flex rounded-full border border-zinc-700 bg-zinc-900 p-0.5 text-xs" role="group" aria-label="Chart axis">
            {(["price", "mcap"] as const).map((a) => (
              <button
                key={a}
                onClick={() => setAxis(a)}
                disabled={a === "mcap" && !clues.supply}
                aria-pressed={axis === a}
                className={`rounded-full px-3 py-1 ${axis === a ? "bg-accent text-black" : "text-zinc-400 disabled:opacity-40"}`}
              >
                {a === "price" ? "Price" : "MCap"}
              </button>
            ))}
          </div>
          <Chart key={round.id} bars={clues.chart} supply={axis === "mcap" ? clues.supply : null} className="h-[50vh] min-h-72 w-full lg:h-[64vh]" />
        </section>

        <aside className="flex flex-col gap-3">
          {/* clues */}
          <section className="flex gap-4 rounded-2xl border border-zinc-800 p-4 text-sm lg:flex-col">
            <div className="size-20 shrink-0 overflow-hidden rounded-xl bg-zinc-900 lg:size-full lg:max-h-72 lg:aspect-square">
              {(clues.logoUrl ?? clues.logoBlurUrl) ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={(clues.logoUrl ?? clues.logoBlurUrl)!} alt="" className="size-full object-cover" />
              ) : (
                <div className="flex size-full items-center justify-center text-xs text-zinc-600">logo at 40s</div>
              )}
            </div>
            <div className="space-y-2">
              <Clue label="Chain" value={clues.chain} at={20} />
              <Clue label="Launchpad" value={clues.launchpad} at={25} />
              <Clue label="Ticker" value={clues.pattern} at={52} mono hidden={tier === "degen"} />
            </div>
          </section>

          {ended && view.answer && (
            <section className="rounded-2xl border border-zinc-700 bg-zinc-900 p-4">
              <p className="text-2xl font-bold">
                ${view.answer.ticker} <span className="text-base font-normal text-zinc-400">{view.answer.name}</span>
              </p>
              <p className="mt-1 text-sm text-zinc-400">
                {view.answer.chain}
                {view.answer.launchpad && ` · ${view.answer.launchpad}`} · peak {fmtUsd(view.answer.peakMcap)}
                {/* under 1% = peaked at launch, or the launch pump predates the data (TRUMP) */}
                {Number(view.answer.pctRun) >= 1 && ` · +${Math.round(Number(view.answer.pctRun)).toLocaleString()}%`}
              </p>
              {runOver ? (
                <RunOver key={round.runId} runId={round.runId} score={run.score} rounds={round.roundNo} onAgain={start} />
              ) : (
                <button onClick={() => next(view.round.id)} className="mt-3 rounded-full bg-accent px-6 py-2 font-semibold text-black">
                  Next round {nextIn != null && `(${Math.ceil(nextIn / 1000)})`}
                </button>
              )}
            </section>
          )}
        </aside>
      </div>

      {!ended && (
        <form onSubmit={submit} className="fixed inset-x-0 bottom-0 border-t border-zinc-800 bg-background/95 p-3 backdrop-blur">
          <div key={shake} className={`mx-auto flex max-w-2xl gap-2 ${shake ? "shake" : ""}`}>
            <input
              value={guess}
              onChange={(e) => setGuess(e.target.value)}
              disabled={busy}
              autoFocus
              autoCapitalize="characters"
              autoComplete="off"
              maxLength={32}
              placeholder="$TICKER"
              aria-label="Your ticker guess"
              className="min-w-0 flex-1 rounded-full border border-zinc-700 bg-zinc-900 px-5 py-3 font-mono uppercase outline-none focus:border-accent"
            />
            <button disabled={busy || !guess.trim()} className="rounded-full bg-accent px-6 font-semibold text-black disabled:opacity-40">
              Guess
            </button>
          </div>
          {flash && (
            <p className={`mx-auto mt-1 max-w-2xl text-center text-sm ${flash.bad ? "text-danger" : "text-accent"}`}>{flash.text}</p>
          )}
        </form>
      )}
      {error && <p className="text-center text-danger">{error}</p>}
    </main>
  );
}

function Heart({ full }: { full: boolean }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className={`size-5 ${full ? "text-danger" : "text-zinc-700"}`}>
      <path
        fill="currentColor"
        d="M12 21s-7.5-4.6-9.6-9.2C.9 8.5 2.9 4.5 6.6 4.5c2.1 0 3.5 1.1 4.4 2.4.9-1.3 2.3-2.4 4.4-2.4 3.7 0 5.7 4 4.2 7.3C19.5 16.4 12 21 12 21z"
      />
    </svg>
  );
}

function Clue({ label, value, at, mono, hidden }: { label: string; value: string | null; at: number; mono?: boolean; hidden?: boolean }) {
  if (hidden) return null;
  return (
    <p>
      <span className="text-zinc-500">{label}: </span>
      {value ? <span className={mono ? "font-mono tracking-widest" : ""}>{value}</span> : <span className="text-zinc-600">at {at}s</span>}
    </p>
  );
}

/** End-of-run modal: share card + actions on the left, this week's board on the right, Play again across the bottom. */
function RunOver({ runId, score, rounds, onAgain }: { runId: string; score: number; rounds: number; onAgain: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [handle, setHandle] = useState<string | null | undefined>(undefined);
  const [board, setBoard] = useState<Entry[] | null>(null);
  const [input, setInput] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const shareUrl = () => `${location.origin}/r/${runId}`;
  const card = `/r/${runId}/opengraph-image?h=${handle ?? ""}`; // re-render after a rename

  function shareOnX() {
    const text = "Think you can name a memecoin from its chart? Beat me on Guess the Meme";
    window.open(`https://x.com/intent/post?text=${encodeURIComponent(text)}&url=${encodeURIComponent(shareUrl())}`, "_blank", "noopener");
  }
  async function copyLink() {
    await navigator.clipboard.writeText(shareUrl());
    setCopied(true);
  }

  useEffect(() => {
    dialog.current?.showModal();
    supabase.auth.getUser().then(async ({ data }) => {
      const { data: p } = await supabase.from("profiles").select("handle").eq("user_id", data.user!.id).maybeSingle();
      setHandle(p?.handle ?? null);
    });
  }, []);

  // refetch after a rename so the highlighted row matches
  useEffect(() => {
    if (handle === undefined) return;
    fetch("/api/leaderboard?scope=weekly")
      .then((r) => (r.ok ? r.json() : []))
      .then(setBoard);
  }, [handle]);

  async function claim(e: React.FormEvent) {
    e.preventDefault();
    try {
      const r = await api<{ handle: string }>("/api/profile/handle", { method: "POST", body: { handle: input } });
      setHandle(r.handle);
    } catch (err) {
      setMsg(err instanceof ApiError && err.status === 409 ? "Taken — try another" : "3–20 letters, numbers or _");
    }
  }

  return (
    <>
      <div className="mt-3 flex gap-2">
        <button onClick={onAgain} className="rounded-full bg-accent px-6 py-2 font-semibold text-black">
          Play again
        </button>
        <button onClick={() => dialog.current?.showModal()} className="rounded-full bg-zinc-800 px-4 py-2 text-sm hover:bg-zinc-700">
          Results
        </button>
      </div>

      <dialog
        ref={dialog}
        aria-label="Run over"
        className="m-auto w-[calc(100%-2rem)] max-w-5xl rounded-2xl border border-zinc-800 bg-zinc-950 p-0 text-foreground backdrop:bg-black/70 backdrop:backdrop-blur-sm"
      >
        <div className="relative grid max-h-[90dvh] gap-6 overflow-y-auto p-5 lg:grid-cols-[minmax(0,1fr)_320px] lg:p-6">
          <button
            onClick={() => dialog.current?.close()}
            aria-label="Close"
            className="absolute right-3 top-3 rounded-full px-2 text-xl leading-none text-zinc-500 hover:text-foreground"
          >
            ×
          </button>

          <section className="space-y-4">
            <p className="text-lg text-zinc-400">
              <b className="text-2xl text-foreground">{score.toLocaleString()}</b> pts in {rounds} rounds
            </p>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={handle === undefined ? undefined : card}
              alt="Your share card"
              width={1200}
              height={630}
              className="aspect-[1200/630] w-full rounded-xl border border-zinc-800 bg-zinc-900"
            />
            <div className="grid grid-cols-3 gap-2 text-sm">
              <button onClick={shareOnX} className="rounded-lg bg-foreground py-2.5 font-semibold text-background hover:opacity-90">
                Post on 𝕏
              </button>
              <button onClick={copyLink} className="rounded-lg bg-zinc-800 py-2.5 hover:bg-zinc-700">
                {copied ? "Copied!" : "Copy link"}
              </button>
              <a href={card} download="guess-the-meme.png" className="rounded-lg bg-zinc-800 py-2.5 text-center hover:bg-zinc-700">
                Save image
              </a>
            </div>
          </section>

          <aside className="space-y-3 lg:border-l lg:border-zinc-800 lg:pl-6">
            <div className="flex items-center justify-between pr-6">
              <h3 className="font-semibold">This week</h3>
              <Link href="/leaderboard" className="text-sm text-zinc-400 hover:text-foreground">
                Full board →
              </Link>
            </div>
            {handle?.startsWith("anon_") && (
              <form onSubmit={claim} className="space-y-1">
                <p className="text-xs text-zinc-500">You&apos;re {handle}. Pick a name:</p>
                <div className="flex gap-2">
                  <input
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    placeholder="Choose a name"
                    aria-label="Leaderboard handle"
                    className="min-w-0 flex-1 rounded-full border border-zinc-700 bg-zinc-900 px-4 py-1.5 text-sm focus:border-zinc-400 focus:outline-none"
                  />
                  <button className="rounded-full bg-zinc-800 px-4 py-1.5 text-sm font-semibold hover:bg-zinc-700">Save</button>
                </div>
                {msg && <p className="text-sm text-danger">{msg}</p>}
              </form>
            )}
            {board ? <Board entries={board} me={handle} /> : <p className="py-8 text-center text-sm text-zinc-500">Loading…</p>}
            <AuthButton />
          </aside>

          <button onClick={onAgain} className="w-full rounded-full bg-accent py-4 text-lg font-semibold text-black hover:opacity-90 lg:col-span-2">
            Play again
          </button>
        </div>
      </dialog>
    </>
  );
}
