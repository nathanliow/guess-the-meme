"use client";
import { CandlestickSeries, ColorType, type IChartApi, type ISeriesApi, createChart } from "lightweight-charts";
import { useEffect, useRef } from "react";
import type { Bar } from "@/lib/game";

const ZOOM_MS = 900;
const usd = (p: number) => (p >= 1 ? `$${p.toFixed(2)}` : `$${p.toPrecision(3)}`);
const compact = (n: number) =>
  n >= 1e9 ? `$${(n / 1e9).toFixed(2)}B` : n >= 1e6 ? `$${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `$${(n / 1e3).toFixed(1)}K` : `$${n.toFixed(0)}`;

/**
 * Candles with real date axis and a USD axis: price, or market cap when `supply` is given.
 * When `bars` widens to cover the previous range (next reveal stage), the view zooms out from the old window.
 */
export default function Chart({ bars, supply, className = "" }: { bars: Bar[]; supply?: number | null; className?: string }) {
  const el = useRef<HTMLDivElement>(null);
  const chart = useRef<IChartApi>(null);
  const series = useRef<ISeriesApi<"Candlestick">>(null);
  const shown = useRef<[number, number] | null>(null); // time range currently on screen

  useEffect(() => {
    chart.current = createChart(el.current!, {
      autoSize: true,
      layout: { background: { type: ColorType.Solid, color: "transparent" }, textColor: "#8a8a95", attributionLogo: true },
      grid: { vertLines: { color: "#16161d" }, horzLines: { color: "#1c1c24" } },
      rightPriceScale: { borderVisible: false },
      timeScale: { borderVisible: false, timeVisible: true },
    });
    series.current = chart.current.addSeries(CandlestickSeries, {
      upColor: "#b6f25c",
      downColor: "#ff5c7a",
      borderVisible: false,
      wickUpColor: "#b6f25c",
      wickDownColor: "#ff5c7a",
      priceLineVisible: false,
    });
    return () => {
      chart.current?.remove();
      shown.current = null;
    };
  }, []);

  useEffect(() => {
    if (!chart.current || !series.current || !bars.length) return;
    const k = supply ?? 1;
    series.current.applyOptions({ priceFormat: { type: "custom", minMove: supply ? 1 : 1e-12, formatter: supply ? compact : usd } });
    series.current.setData(bars.map(([t, o, h, l, c]) => ({ time: t as never, open: o * k, high: h * k, low: l * k, close: c * k })));

    const ts = chart.current.timeScale();
    const prev = shown.current;
    const range: [number, number] = [bars[0][0], bars.at(-1)![0]];
    shown.current = range;
    const widened = prev && range[0] <= prev[0] && range[1] >= prev[1] && (range[0] < prev[0] || range[1] > prev[1]);
    if (!widened) {
      if (!prev || prev[0] !== range[0] || prev[1] !== range[1]) ts.fitContent(); // same range (price ⇄ mcap) keeps the view
      return;
    }

    // start on the previous window's bars, ease out to everything. The old window can sit inside one coarser
    // bar (hours of 15m candles → one daily candle), so always start at least one bar wide or the chart throws.
    const from0 = Math.max(0, bars.findIndex((b) => b[0] >= prev[0])) - 0.5;
    const to0 = Math.max(from0 + 1, bars.findLastIndex((b) => b[0] <= prev[1]) + 0.5);
    const from1 = -0.5;
    const to1 = bars.length - 0.5;
    let raf = 0;
    const t0 = performance.now();
    const step = (now: number) => {
      const p = Math.min(1, (now - t0) / ZOOM_MS);
      const e = 1 - (1 - p) ** 3;
      ts.setVisibleLogicalRange({ from: from0 + (from1 - from0) * e, to: to0 + (to1 - to0) * e });
      if (p < 1) raf = requestAnimationFrame(step);
    };
    ts.setVisibleLogicalRange({ from: from0, to: to0 });
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [bars, supply]);

  return <div ref={el} className={className} />;
}
