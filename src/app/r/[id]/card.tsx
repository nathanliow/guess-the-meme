// Share card (1200×630). Rendered by next/og (Satori): flexbox only, every multi-child div needs display:flex.
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";
import { type ShareData, verdict } from "@/lib/share";

export const size = { width: 1200, height: 630 };

const LIME = "#b6f25c";
const RED = "#ff5c7a";
const BG = "#0b0b0f";
const MUTED = "#8a8a95";
const MAX_LOGOS = 8;
// Vercel sets this to the production domain; fallback for local dev.
const SITE = process.env.VERCEL_PROJECT_PRODUCTION_URL ?? "guess-the-meme.vercel.app";

/** The featured token's real price line (log scale) as the backdrop. */
function Spark({ values }: { values: number[] }) {
  const ys = values.filter((v) => v > 0).map(Math.log10);
  if (ys.length < 2) return null;
  const lo = Math.min(...ys);
  const span = Math.max(...ys) - lo || 1;
  const pts = ys.map((y, i) => [(i / (ys.length - 1)) * 1200, 620 - ((y - lo) / span) * 230]);
  const line = pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`).join(" ");
  return (
    <svg width="1200" height="630" viewBox="0 0 1200 630" style={{ position: "absolute", left: 0, top: 0 }}>
      <defs>
        <linearGradient id="fade" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={LIME} stopOpacity="0.16" />
          <stop offset="1" stopColor={LIME} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={`${line} L1200 630 L0 630 Z`} fill="url(#fade)" />
      <path d={line} fill="none" stroke={LIME} strokeOpacity="0.3" strokeWidth="4" strokeLinejoin="round" />
    </svg>
  );
}

function Logo({ src, ticker, i }: { src: string | null; ticker: string; i: number }) {
  const style = { width: 76, height: 76, borderRadius: 76, border: `4px solid ${BG}`, marginLeft: i ? -18 : 0, background: "#1c1c24" };
  // eslint-disable-next-line @next/next/no-img-element
  return src ? <img src={src} alt={ticker} width={76} height={76} style={style} /> : <div style={{ ...style, display: "flex" }} />;
}

export async function renderCard(d: ShareData) {
  const [medium, black] = await Promise.all([
    readFile(join(process.cwd(), "assets/fonts/Geist-Medium.ttf")),
    readFile(join(process.cwd(), "assets/fonts/Geist-Black.ttf")),
  ]);
  const n = d.called.length;
  const extra = n - MAX_LOGOS;

  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", background: BG, color: "#ededf0", fontFamily: "Geist", padding: 56, position: "relative" }}>
        <Spark values={d.spark} />

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ display: "flex", fontSize: 26, fontWeight: 900, letterSpacing: 5, color: LIME }}>GUESS THE MEME</div>
          <div style={{ display: "flex", fontSize: 26, padding: "8px 22px", borderRadius: 40, border: "2px solid #2a2a33", color: "#c9c9d1" }}>@{d.handle}</div>
        </div>

        <div style={{ display: "flex", flex: 1, alignItems: "center", gap: 56 }}>
          {/* placement */}
          <div style={{ display: "flex", flexDirection: "column", width: 400 }}>
            <div style={{ display: "flex", fontSize: 24, letterSpacing: 6, color: MUTED }}>RANKED</div>
            <div style={{ display: "flex", fontSize: d.rank >= 100 ? 170 : 230, fontWeight: 900, lineHeight: 1, color: LIME, letterSpacing: -8 }}>#{d.rank}</div>
            <div style={{ display: "flex", fontSize: 24, letterSpacing: 6, color: MUTED }}>{d.board.toUpperCase()}</div>
          </div>

          {/* tokens called */}
          <div style={{ display: "flex", flexDirection: "column", flex: 1, gap: 22 }}>
            <div style={{ display: "flex", fontSize: 62, fontWeight: 900, lineHeight: 1.05 }}>{verdict(n)}</div>
            <div style={{ display: "flex", gap: 12, fontSize: 34, color: "#c9c9d1" }}>
              <span style={{ color: LIME, fontWeight: 900 }}>{n}</span>
              <span>{n === 1 ? "coin" : "coins"} guessed correctly</span>
            </div>

            {n > 0 && (
              <div style={{ display: "flex", alignItems: "center" }}>
                {d.called.slice(0, MAX_LOGOS).map((c, i) => (
                  <Logo key={c.ticker + i} src={c.logo} ticker={c.ticker} i={i} />
                ))}
                {extra > 0 && (
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 76, height: 76, borderRadius: 76, marginLeft: -18, background: "#1c1c24", border: `4px solid ${BG}`, fontSize: 24, fontWeight: 900 }}>
                    +{extra}
                  </div>
                )}
              </div>
            )}

            {d.fastest && (
              <div style={{ display: "flex", alignSelf: "flex-start", alignItems: "center", gap: 14, fontSize: 26, padding: "10px 20px", borderRadius: 14, background: "#16161d" }}>
                <span style={{ color: MUTED, letterSpacing: 3, fontSize: 20 }}>FASTEST CALL</span>
                <span style={{ fontWeight: 900 }}>${d.fastest.ticker}</span>
                <span style={{ color: LIME }}>{d.fastest.secs.toFixed(1)}s</span>
              </div>
            )}

            {d.nemesis && (
              <div style={{ display: "flex", alignItems: "center", gap: 16, fontSize: 30 }}>
                <Logo src={d.nemesis.logo} ticker={d.nemesis.ticker} i={0} />
                <span style={{ color: MUTED }}>taken out by</span>
                <span style={{ color: RED, fontWeight: 900 }}>${d.nemesis.ticker}</span>
              </div>
            )}
          </div>
        </div>

        <div style={{ display: "flex", fontSize: 30, color: "#c9c9d1" }}>{SITE}</div>
      </div>
    ),
    {
      ...size,
      fonts: [
        { name: "Geist", data: medium, weight: 500, style: "normal" },
        { name: "Geist", data: black, weight: 900, style: "normal" },
      ],
    },
  );
}
