// Token ingest: Codex → Supabase, run once per token. `npm run ingest -- <command>`
//   spike                         check what the free Codex plan returns (run first)
//   discover [chain…]             find candidate memecoins → tokens (pending)
//   add <addr:networkId> [--from <unix>] [--to <unix>]   add one token by hand
//   enrich                        metadata, launchpad, logo + blurred logo
//   bars                          full + detail candles
//   derive                        peak/launch mcap, % run, highlight window, initial tier → playable
//   all                           enrich → bars → derive
import { createClient } from "@supabase/supabase-js";
import sharp from "sharp";
import type { Bar } from "../../src/lib/game";
import { type Chain, NETWORKS, chainOf, filterTokens, getBars, gql, requestCount } from "./codex";
import { clampToAth, cleanTicker, highlightFor, tierFor } from "./lib";

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false },
});

// Set after `spike` shows the meme category slug; empty = no category filter.
const MEME_CATEGORY = process.env.CODEX_MEME_CATEGORY ?? "";
const SKIP_TICKERS = new Set(["USDC", "USDT", "DAI", "WETH", "WBNB", "WSOL", "SOL", "ETH", "BNB", "WBTC", "CBBTC", "USD1", "FDUSD", "PYUSD"]);
const DAY = 86_400;

const latin = (s: string) => /^[\x21-\x7E]+$/.test(s);
const now = () => Math.floor(Date.now() / 1000);

// ───────────── spike ─────────────

async function spike() {
  const cats = await gql<{ categories: { slug: string; name: string; memberCount: number | null }[] }>(
    `{ categories(status: ACTIVE) { slug name memberCount } }`,
  );
  console.log("meme-ish categories:", cats.categories.filter((c) => /meme/i.test(c.slug + c.name)));

  const known = [
    "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263:1399811149", // BONK (2022)
    "0x6982508145454ce325ddbe47a25d4ec3d2311933:1", // PEPE (2023)
    "9BB6NFEcjBCtnNLFko2FqVQBq8HHM13kCyYcdQbgpump:1399811149", // FARTCOIN (pump.fun)
    "0x532f27101965dd16442e59d40670faf5ebb142e4:8453", // BRETT (Base)
  ];
  const tokens = [
    ...(await filterTokens({ tokens: known })),
    ...(await filterTokens({ filters: { network: [NETWORKS.bsc] }, rankings: [{ attribute: "holders", direction: "DESC" }], limit: 1 })),
    ...(await filterTokens({ filters: { network: [NETWORKS.robinhood] }, rankings: [{ attribute: "holders", direction: "DESC" }], limit: 1 })),
  ];
  for (const t of tokens) {
    const img = t.info?.imageLargeUrl ?? t.info?.imageSmallUrl;
    const imgOk = img ? (await fetch(img).catch(() => null))?.ok : false;
    const bars = t.createdAt ? await getBars(`${t.address}:${t.networkId}`, t.createdAt, now(), "1D") : [];
    console.log({
      ticker: t.symbol,
      chain: chainOf(t.networkId),
      launchpad: t.launchpad?.launchpadName ?? null,
      hasDescription: !!t.info?.description,
      athFdv: t.extrema?.athFdv,
      image: imgOk ? "ok" : `FAIL ${img}`,
      createdAt: t.createdAt && new Date(t.createdAt * 1000).toISOString(),
      dailyBars: bars.length,
      firstBar: bars[0] && new Date(bars[0][0] * 1000).toISOString(),
    });
  }
}

// ───────────── discover / add ─────────────

async function discover(chains: Chain[]) {
  const base = { potentialScam: false, ...(MEME_CATEGORY ? { categories: { anyOf: [MEME_CATEGORY] } } : {}) };
  for (const chain of chains) {
    const network = [NETWORKS[chain]];
    const found = [
      // (a) big now
      ...(await filterTokens({ filters: { ...base, network, liquidity: { gt: 50_000 } }, rankings: [{ attribute: "marketCap", direction: "DESC" }] })),
      // (b) dead-but-famous: big peak, many holders, any current mcap
      ...(await filterTokens({ filters: { ...base, network, athFdv: { gt: 10_000_000 } }, rankings: [{ attribute: "holders", direction: "DESC" }] })),
      // (c) launchpad graduates
      ...(await filterTokens({ filters: { ...base, network, launchpadMigrated: true }, rankings: [{ attribute: "holders", direction: "DESC" }] })),
    ];
    const rows = new Map<string, Record<string, unknown>>();
    for (const t of found) {
      const ticker = cleanTicker(t.symbol);
      if (!ticker || !latin(ticker) || SKIP_TICKERS.has(ticker.toUpperCase())) continue;
      rows.set(t.address, { network_id: t.networkId, chain, address: t.address, name: t.name, ticker });
    }
    const { error } = await db.from("tokens").upsert([...rows.values()], { onConflict: "network_id,address", ignoreDuplicates: true });
    if (error) throw error;
    console.log(`${chain}: ${rows.size} candidates`);
  }
}

async function add(symbol: string, opts: { from?: number; to?: number }) {
  const [address, net] = symbol.split(":");
  const networkId = Number(net);
  if (!address || !chainOf(networkId)) throw new Error(`usage: add <address:networkId>, networkId one of ${Object.values(NETWORKS)}`);
  const { error } = await db.from("tokens").upsert(
    { network_id: networkId, chain: chainOf(networkId), address, full_from: opts.from ?? null, full_to: opts.to ?? null },
    { onConflict: "network_id,address" },
  );
  if (error) throw error;
  console.log(`added ${symbol} — run: npm run ingest -- all`);
}

// ───────────── enrich ─────────────

// ponytail: Solana mint-suffix fallback only; EVM launchpads rely on Codex. Add a deployer→launchpad table if spike shows gaps.
function launchpadFallback(address: string) {
  if (address.endsWith("pump")) return "Pump.fun";
  if (address.endsWith("bonk")) return "LetsBonk";
  if (address.endsWith("BAGS")) return "Bags";
  return null;
}

async function storeLogo(id: number, url: string) {
  const res = await fetch(url);
  if (!res.ok) return null;
  const img = sharp(Buffer.from(await res.arrayBuffer())).resize(256, 256, { fit: "cover" });
  const clear = await img.clone().png().toBuffer();
  const blur = await img.clone().blur(14).png().toBuffer();
  const up = async (path: string, body: Buffer) => {
    const { error } = await db.storage.from("logos").upload(path, body, { contentType: "image/png", upsert: true });
    if (error) throw error;
    return path;
  };
  return { logo_path: await up(`${id}.png`, clear), logo_blur_path: await up(`${id}-blur.png`, blur) };
}

async function enrich() {
  const { data: rows, error } = await db.from("tokens").select("id, network_id, address").eq("status", "pending").is("logo_path", null);
  if (error) throw error;
  for (let i = 0; i < rows.length; i += 200) {
    const batch = rows.slice(i, i + 200);
    const meta = await filterTokens({ tokens: batch.map((r) => `${r.address}:${r.network_id}`) });
    for (const row of batch) {
      const t = meta.find((m) => m.address.toLowerCase() === row.address.toLowerCase() && m.networkId === row.network_id);
      if (!t) {
        console.warn(`no codex data: ${row.address}`);
        continue;
      }
      const img = t.info?.imageLargeUrl ?? t.info?.imageSmallUrl;
      const logos = img ? await storeLogo(row.id, img).catch(() => null) : null;
      await db
        .from("tokens")
        .update({
          name: t.name,
          ticker: cleanTicker(t.symbol),
          launchpad: t.launchpad?.launchpadName ?? launchpadFallback(t.address),
          description: t.info?.description ?? null,
          supply: t.info?.totalSupply ? Number(t.info.totalSupply) : null,
          launch_at: t.createdAt ? new Date(t.createdAt * 1000).toISOString() : null,
          ...logos,
        })
        .eq("id", row.id);
      console.log(`enriched ${t.symbol}${logos ? "" : " (no logo)"}`);
    }
  }
}

// ───────────── bars ─────────────

/** Largest resolution step whose bar count fits in 1500 for this span. */
function fullResolution(spanS: number) {
  return spanS <= 250 * DAY ? "240" : spanS <= 1500 * DAY ? "1D" : "7D";
}
function detailResolution(spanS: number) {
  return spanS <= 15 * DAY ? "15" : spanS <= 60 * DAY ? "60" : spanS <= 250 * DAY ? "240" : null;
}

async function bars() {
  const { data: rows, error } = await db
    .from("tokens")
    .select("id, network_id, address, ticker, launch_at, full_from, full_to, candles(series)")
    .eq("status", "pending")
    .not("launch_at", "is", null);
  if (error) throw error;
  const todo = rows.filter((r) => !r.candles.length);
  // all-time highs, to drop bad-data candles (e.g. SHIB's early-2021 bars at ~70× its real ATH)
  const ath = new Map<string, number>();
  for (let i = 0; i < todo.length; i += 200) {
    const meta = await filterTokens({ tokens: todo.slice(i, i + 200).map((r) => `${r.address}:${r.network_id}`) });
    for (const m of meta) if (m.extrema?.athPrice) ath.set(`${m.address.toLowerCase()}:${m.networkId}`, Number(m.extrema.athPrice));
  }
  for (const row of todo) {
    const symbol = `${row.address}:${row.network_id}`;
    const athPrice = ath.get(`${row.address.toLowerCase()}:${row.network_id}`) ?? null;
    const launch = Math.floor(Date.parse(row.launch_at) / 1000);
    const from = row.full_from ?? launch;
    const to = row.full_to ?? now();
    const fullRes = fullResolution(to - from);
    const full = clampToAth(await getBars(symbol, from, to, fullRes), athPrice);
    if (full.length < 5) {
      console.warn(`${row.ticker}: only ${full.length} bars, skipped`);
      continue;
    }
    const start = full[0][0];
    const peakT = full.reduce((a, b) => (b[4] > a[4] ? b : a))[0];
    const detailTo = Math.max(peakT + (peakT - start), start + DAY);
    const res = detailResolution(detailTo - start);
    const detail = res ? clampToAth(await getBars(symbol, start, detailTo, res), athPrice) : full;
    const { error: e } = await db.from("candles").upsert([
      { token_id: row.id, series: "full", resolution: fullRes, bars: full },
      { token_id: row.id, series: "detail", resolution: res ?? fullRes, bars: detail.length >= 5 ? detail : full },
    ]);
    if (e) throw e;
    console.log(`${row.ticker}: full ${full.length}@${fullRes}, detail ${detail.length}@${res ?? fullRes}`);
  }
}

// ───────────── derive ─────────────

async function derive() {
  const { data: rows, error } = await db
    .from("tokens")
    .select("id, ticker, supply, candles(series, bars)")
    .eq("status", "pending")
    .is("tier", null);
  if (error) throw error;
  for (const row of rows) {
    const full = row.candles.find((c) => c.series === "full")?.bars as Bar[] | undefined;
    const detail = row.candles.find((c) => c.series === "detail")?.bars as Bar[] | undefined;
    if (!full?.length || !detail?.length || !row.supply) continue;
    const maxClose = Math.max(...full.map((b) => b[4]));
    const firstClose = full[0][4];
    const peak = maxClose * row.supply;
    const hl = highlightFor(detail);
    await db
      .from("tokens")
      .update({
        peak_mcap: peak,
        launch_mcap: firstClose * row.supply,
        pct_run: firstClose > 0 ? (maxClose / firstClose - 1) * 100 : null,
        highlight_from: hl.from,
        highlight_to: hl.to,
        tier: tierFor(peak),
        status: "approved", // playable as soon as its data is complete; reject in /admin
      })
      .eq("id", row.id);
    console.log(`${row.ticker}: peak $${(peak / 1e6).toFixed(1)}M → ${tierFor(peak)}`);
  }
}

// ───────────── main ─────────────

const [cmd, ...args] = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? Number(args[i + 1]) : undefined;
};

const commands: Record<string, () => Promise<void>> = {
  spike,
  discover: () => {
    const chains = (args.length ? args : Object.keys(NETWORKS)) as Chain[];
    if (chains.some((c) => !(c in NETWORKS))) throw new Error(`chains: ${Object.keys(NETWORKS).join(", ")}`);
    return discover(chains);
  },
  add: () => add(args[0], { from: flag("from"), to: flag("to") }),
  enrich,
  bars,
  derive,
  all: async () => {
    await enrich();
    await bars();
    await derive();
  },
};

if (!commands[cmd]) {
  console.log("commands:", Object.keys(commands).join(", "));
  process.exit(1);
}
if (!process.env.CODEX_API_KEY && cmd !== "derive") throw new Error("CODEX_API_KEY missing in .env.local");
commands[cmd]()
  .then(() => console.log(`done — ${requestCount} Codex requests`))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });

