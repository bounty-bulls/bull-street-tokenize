const syms = ["^NSEI", "RELIANCE.NS", "TCS.NS", "INFY.NS", "HDFCBANK.NS", "ICICIBANK.NS", "HINDUNILVR.NS", "INR=X", "HIMS"];
import { writeFileSync } from "node:fs";
for (const s of syms) {
  for (let i = 0; i < 4; i++) {
    const r = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(s)}?range=10y&interval=1d`);
    if (r.ok) { const j = await r.json(); writeFileSync(`${s.replace(/[^A-Za-z0-9]/g, "_")}.json`, JSON.stringify(j)); console.log(s, "ok", j.chart.result[0].timestamp.length); break; }
    console.log(s, r.status); await new Promise((x) => setTimeout(x, 4000));
  }
  await new Promise((x) => setTimeout(x, 1500));
}
