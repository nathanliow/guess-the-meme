# Guess the Meme

Name the memecoin from its chart. Each 60-second round starts on a zoomed-in slice of a token's pump and reveals more as the clock runs: wider chart, full chart, chain, launchpad, blurred logo, logo, ticker pattern. Answer with the ticker. Endless runs, three lives, difficulty rises each round, global weekly and all-time leaderboards.

Built with Next.js (App Router), Tailwind, Supabase (Postgres, Auth, Storage) and [TradingView Lightweight Charts](https://www.tradingview.com/lightweight-charts/). Token data comes from the [Codex](https://www.codex.io) API once, at ingest time — nothing is fetched during play.

## How it works

- **Server-authoritative.** The browser never sees more than the unlocked clues. Rounds, guesses, lives and scoring live in Postgres functions (`supabase/migrations/`) called by route handlers with the service-role key; clients have no direct table access (RLS on, no client policies).
- **Rules.** Wrong guess costs a life; timing out costs nothing but resets your streak. Points decay over the round and grow with your streak. Tiers by round: 1–5 easy, 6–12 medium, 13–20 hard, 21+ degen.
- **Identity.** Anonymous Supabase sign-in on first visit (default handle `anon_xxxxxxxx`, renamable), optionally linked to X.
- **Share cards.** `/r/[runId]` renders an Open Graph image of your placement and the coins you called.

## Setup

```bash
npm install
cp .env.local.example .env.local   # fill in the values
```

1. **Supabase.** Create a project and apply the migrations (`supabase link` then `supabase db push`, or run the files in `supabase/migrations/` in order). In Auth settings enable **anonymous sign-ins** and **manual identity linking**; to offer Sign in with X, enable the **X (Twitter)** provider and add your site URL to the redirect URLs.
2. **Codex.** Get an API key at [dashboard.codex.io](https://dashboard.codex.io). The free plan is plenty — ingest costs ~3 requests per token. Only the ingest scripts use it; the deployed app doesn't need it.
3. **Admin (optional).** Put your auth user id in `ADMIN_USER_IDS` to use `/admin` for reviewing charts, highlight windows and tiers.

## Adding tokens

```bash
npm run ingest -- add <address>:<networkId>   # e.g. a Solana mint with 1399811149
npm run ingest -- all                         # metadata + logo, candles, derived stats → playable
```

Network ids: Solana `1399811149`, Ethereum `1`, Base `8453`, BSC `56`, Robinhood Chain `4663`. `npm run ingest` with no args lists every command (including `discover`, which pulls candidates from Codex rankings).

## Develop

```bash
npm run dev     # http://localhost:3000
npm run check   # game-logic assertions
npm run lint
supabase db query --linked -f scripts/check-db.sql   # DB function checks; rolls back, expects CHECK_DB_PASSED
```

## License

[MIT](LICENSE). Geist fonts in `assets/fonts` are under the [SIL Open Font License](assets/fonts/OFL.txt). Charts by TradingView Lightweight Charts (Apache-2.0). Token data © Codex; logos belong to their projects.
