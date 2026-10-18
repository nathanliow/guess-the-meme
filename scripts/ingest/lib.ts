// Pure ingest helpers (tested in scripts/check-game.ts).
import type { Bar, Tier } from "../../src/lib/game";

export function tierFor(peakMcap: number): Tier {
  return peakMcap >= 1e9 ? "easy" : peakMcap >= 1e8 ? "medium" : peakMcap >= 1e7 ? "hard" : "degen";
}

/** The run-up into the peak: ~1/10 of `detail` (min 8 bars), ending at the highest close. */
export function highlightFor(detail: Bar[]) {
  const p = detail.reduce((best, b, i) => (b[4] > detail[best][4] ? i : best), 0);
  const width = Math.min(detail.length, Math.max(8, Math.round(detail.length / 10)));
  const s = Math.max(0, p - width + 1);
  return { from: detail[s][0], to: detail[Math.max(p, s + width - 1)][0] };
}

/**
 * Drop bad-data candles: closes above 1.5× Codex's all-time high go, wicks are clipped to it.
 * Only when they're a small minority (SHIB: 6% junk bars) — if most bars exceed it, Codex's ATH
 * is the wrong one (michi, HIGHER, BabyDoge) and the candles are kept as-is.
 */
export function clampToAth(bars: Bar[], athPrice: number | null): Bar[] {
  if (!athPrice) return bars;
  const cap = athPrice * 1.5;
  const kept = bars.filter((b) => b[4] <= cap && b[1] <= cap);
  if (kept.length < bars.length * 0.8) return bars;
  return kept.map(([t, o, h, l, c]) => [t, o, Math.min(h, cap), l, c]);
}

export const cleanTicker = (s: string | null) => s?.trim().replace(/^\$+/, "") ?? null;
