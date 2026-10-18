// Minimal Codex GraphQL client. Free plan: 5 req/s, 10k req/month — we stay at ~4 req/s and count calls.
import type { Bar } from "../../src/lib/game";

export const NETWORKS = {
  solana: 1399811149,
  base: 8453,
  bsc: 56,
  ethereum: 1,
  robinhood: 4663,
} as const;
export type Chain = keyof typeof NETWORKS;
export const chainOf = (networkId: number) =>
  (Object.keys(NETWORKS) as Chain[]).find((c) => NETWORKS[c] === networkId)!;

export let requestCount = 0;
let last = 0;

export async function gql<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
  const wait = last + 250 - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  last = Date.now();
  requestCount++;
  const res = await fetch("https://graph.codex.io/graphql", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: process.env.CODEX_API_KEY! },
    body: JSON.stringify({ query, variables }),
  });
  const json = await res.json();
  if (!res.ok || json.errors) throw new Error(`codex: ${res.status} ${JSON.stringify(json.errors ?? json)}`);
  return json.data as T;
}

export type CodexToken = {
  address: string;
  networkId: number;
  name: string | null;
  symbol: string | null;
  createdAt: number | null;
  info: { description: string | null; imageLargeUrl: string | null; imageSmallUrl: string | null; totalSupply: string | null } | null;
  launchpad: { launchpadName: string | null; migrated: boolean | null } | null;
  extrema: { athFdv: string; athPrice: string; athPriceTimestamp: number } | null;
};

const TOKEN_FIELDS = `
  address networkId name symbol createdAt
  info { description imageLargeUrl imageSmallUrl totalSupply }
  launchpad { launchpadName migrated }
  extrema { athFdv athPrice athPriceTimestamp }
`;

/** filterTokens; pass `tokens: ["addr:networkId", …]` (≤200) for a batched metadata lookup. */
export async function filterTokens(args: {
  filters?: Record<string, unknown>;
  rankings?: { attribute: string; direction: "ASC" | "DESC" }[];
  tokens?: string[];
  limit?: number;
}): Promise<CodexToken[]> {
  const data = await gql<{ filterTokens: { results: { token: CodexToken | null }[] } }>(
    `query($filters: TokenFilters, $rankings: [TokenRanking], $tokens: [String], $limit: Int) {
      filterTokens(filters: $filters, rankings: $rankings, tokens: $tokens, limit: $limit) {
        results { token { ${TOKEN_FIELDS} } }
      }
    }`,
    { limit: 200, ...args },
  );
  return data.filterTokens.results.flatMap((r) => (r.token ? [r.token] : []));
}

/**
 * Token-level bars (all pools combined). ≤1500 per call — callers pick the resolution to fit.
 * getTokenBars over getBars: much more history for older tokens (e.g. BRETT from launch vs +7 months).
 */
export async function getBars(symbol: string, from: number, to: number, resolution: string): Promise<Bar[]> {
  const data = await gql<{ getTokenBars: { t: number[]; o: (number | null)[]; h: (number | null)[]; l: (number | null)[]; c: (number | null)[] } | null }>(
    `query($symbol: String!, $from: Int!, $to: Int!, $resolution: String!) {
      getTokenBars(symbol: $symbol, from: $from, to: $to, resolution: $resolution, countback: 1500,
                   removeLeadingNullValues: true) { t o h l c }
    }`,
    { symbol, from, to, resolution },
  );
  const b = data.getTokenBars;
  if (!b) return [];
  return b.t.flatMap((t, i) =>
    b.o[i] == null || b.h[i] == null || b.l[i] == null || b.c[i] == null ? [] : [[t, b.o[i]!, b.h[i]!, b.l[i]!, b.c[i]!] as Bar],
  );
}
