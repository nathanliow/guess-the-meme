// Runnable check for src/lib/game.ts: `npx tsx scripts/check-game.ts`
import assert from "node:assert/strict";
import {
  type Bar,
  nextStageAt,
  normalizeTicker,
  scoreFor,
  sliceWindow,
  stagesAt,
  tickerPattern,
} from "../src/lib/game";
import { clampToAth, cleanTicker, highlightFor, tierFor } from "./ingest/lib";

// stage boundaries
assert.deepEqual(stagesAt(4_900, "easy"), ["chart0"]);
assert.deepEqual(stagesAt(5_000, "easy"), ["chart0", "chart1"]);
assert.equal(stagesAt(59_999, "easy").length, 9);
assert.ok(!stagesAt(59_999, "easy").includes("description" as never));
assert.ok(!stagesAt(59_999, "degen").includes("logo"));
assert.ok(!stagesAt(59_999, "degen").includes("pattern"));
assert.ok(stagesAt(59_999, "degen").includes("logoBlur"));
assert.equal(nextStageAt(0, "easy"), 5_000);
assert.equal(nextStageAt(41_000, "easy"), 45_000);
assert.equal(nextStageAt(41_000, "degen"), 60_000);

// tickers
assert.equal(normalizeTicker("$wif "), "WIF");
assert.equal(normalizeTicker(" $$mo odeng"), "MOODENG");
assert.equal(tickerPattern("WIF"), "W _ _");

// scoring: decay, streak multiplier, cap at 2×
assert.equal(scoreFor("easy", 0, 0), 100);
assert.equal(scoreFor("easy", 30_000, 0), 50);
assert.equal(scoreFor("degen", 0, 5), 1500);
assert.equal(scoreFor("degen", 0, 50), 2000);
assert.equal(scoreFor("hard", 70_000, 0), 0);

// windows
const bars = (n: number): Bar[] => Array.from({ length: n }, (_, i) => [i, i, i, i, i]);
const detail = bars(100);
const full = bars(10).map((b) => [b[0] * 10, 0, 0, 0, 0] as Bar);
const range = (w: Bar[]) => [w[0][0], w.at(-1)![0]];

// left growth: highlight 60..69
const hl = { from: 60, to: 69 };
assert.deepEqual(range(sliceWindow(detail, full, hl, 0)), [60, 69]);
assert.deepEqual(range(sliceWindow(detail, full, hl, 1)), [40, 69]);
assert.deepEqual(range(sliceWindow(detail, full, hl, 2)), [10, 69]);
assert.equal(sliceWindow(detail, full, hl, 3), full);

// spill right when the highlight starts at launch
const atLaunch = { from: 0, to: 9 };
assert.deepEqual(range(sliceWindow(detail, full, atLaunch, 1)), [0, 29]);
assert.deepEqual(range(sliceWindow(detail, full, atLaunch, 2)), [0, 59]);

// partial left room then spill right
assert.deepEqual(range(sliceWindow(detail, full, { from: 5, to: 14 }, 1)), [0, 29]);

// 6× wider than detail → full
assert.equal(sliceWindow(detail, full, { from: 50, to: 69 }, 2), full);

// each stage ⊇ previous
for (const h of [hl, atLaunch, { from: 5, to: 14 }, { from: 90, to: 99 }]) {
  let prev: number[] | null = null;
  for (const s of [0, 1, 2]) {
    const w = sliceWindow(detail, full, h, s);
    if (w === full) break;
    const [a, b] = range(w);
    if (prev) assert.ok(a <= prev[0] && b >= prev[1], `stage ${s} not superset for ${JSON.stringify(h)}`);
    prev = [a, b];
  }
}

// ingest helpers
assert.equal(tierFor(2e9), "easy");
assert.equal(tierFor(5e8), "medium");
assert.equal(tierFor(5e7), "hard");
assert.equal(tierFor(5e6), "degen");
const pump = bars(100).map((b, i) => [i, 0, 0, 0, i === 70 ? 999 : 1] as Bar);
assert.deepEqual(highlightFor(pump), { from: 61, to: 70 }, "highlight ends at peak, 1/10 width");
const early = bars(100).map((b, i) => [i, 0, 0, 0, i === 2 ? 999 : 1] as Bar);
assert.deepEqual(highlightFor(early), { from: 0, to: 9 }, "early peak keeps min width");

const clean = Array.from({ length: 9 }, (_, i) => [i, 1, 2, 1, 1] as Bar);
const dirty: Bar[] = [...clean, [9, 70, 70, 70, 70], [10, 1, 9, 1, 2]];
assert.deepEqual(clampToAth(dirty, 2), [...clean, [10, 1, 3, 1, 2]], "bad close dropped, wick clipped");
assert.equal(clampToAth(dirty, null), dirty);
const wrongAth = Array.from({ length: 10 }, (_, i) => [i, 5, 5, 5, 5] as Bar);
assert.equal(clampToAth(wrongAth, 1), wrongAth, "most bars above ATH → Codex ATH is wrong, keep bars");
assert.equal(cleanTicker(" $$MYRO "), "MYRO");

console.log("check-game: all passed");
