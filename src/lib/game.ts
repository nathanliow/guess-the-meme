// Round rules shared by the API (what to reveal) and the client (timer, live "worth N").
// Points are authoritative in SQL (submit_guess) — scoreFor mirrors it for display.

export type Tier = "easy" | "medium" | "hard" | "degen";
export type Bar = [t: number, o: number, h: number, l: number, c: number];

export const ROUND_MS = 60_000;

export const STAGES = [
  { at: 0, key: "chart0" },
  { at: 5_000, key: "chart1" },
  { at: 10_000, key: "chart2" },
  { at: 15_000, key: "chart3" },
  { at: 20_000, key: "chain" },
  { at: 25_000, key: "launchpad" },
  { at: 40_000, key: "logoBlur" },
  { at: 45_000, key: "logo" },
  { at: 52_000, key: "pattern" },
] as const;

export type StageKey = (typeof STAGES)[number]["key"];

const DEGEN_SKIPS: StageKey[] = ["logo", "pattern"];

export const TIER_BASE: Record<Tier, number> = { easy: 100, medium: 250, hard: 500, degen: 1000 };

function stagesFor(tier: Tier) {
  return STAGES.filter((s) => tier !== "degen" || !DEGEN_SKIPS.includes(s.key));
}

/** Stage keys unlocked at `elapsedMs` into a round. */
export function stagesAt(elapsedMs: number, tier: Tier): StageKey[] {
  return stagesFor(tier)
    .filter((s) => elapsedMs >= s.at)
    .map((s) => s.key);
}

/** When the next reveal happens (ms into the round); ROUND_MS if none left. */
export function nextStageAt(elapsedMs: number, tier: Tier): number {
  return stagesFor(tier).find((s) => s.at > elapsedMs)?.at ?? ROUND_MS;
}

/** Must match normalize_ticker() in SQL. */
export function normalizeTicker(s: string): string {
  return s.trim().replace(/^\$+/, "").replace(/\s+/g, "").toUpperCase();
}

/** `streak` = consecutive correct answers before this one. Mirrors submit_guess. */
export function scoreFor(tier: Tier, elapsedMs: number, streak: number): number {
  const timeLeft = Math.max(0, ROUND_MS - elapsedMs) / ROUND_MS;
  return Math.round(TIER_BASE[tier] * timeLeft * Math.min(1 + 0.1 * streak, 2));
}

export function tickerPattern(ticker: string): string {
  const chars = [...ticker];
  return [chars[0], ...chars.slice(1).map(() => "_")].join(" ");
}

const WIDTHS = [1, 3, 6];

/**
 * Chart window for chart stages 0–3. Starts at the highlight, widens 3× then 6× — leftward
 * first, spilling right once it hits the start of `detail`. Wider than `detail` → `full`.
 */
export function sliceWindow(
  detail: Bar[],
  full: Bar[],
  highlight: { from: number; to: number },
  stage: number,
): Bar[] {
  if (stage >= 3) return full;
  const i0 = detail.findIndex((b) => b[0] >= highlight.from);
  const i1 = detail.findLastIndex((b) => b[0] <= highlight.to);
  if (i0 < 0 || i1 < i0) return full;
  const width = (i1 - i0 + 1) * WIDTHS[stage];
  if (width > detail.length) return full;
  const left = Math.max(0, i1 + 1 - width);
  return detail.slice(left, left + width);
}

