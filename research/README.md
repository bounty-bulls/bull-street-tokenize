# Research: how much prices move while markets are closed

```
cd research
node fetch-prices.mjs            # 10y of daily prices from Yahoo Finance into ./*.json
python3 gaps.py .                # closure gaps, share of variance while closed, naive-redemption leak
python3 squeeze.py               # HIMS-style squeeze: frozen supply vs pledge-backed minting
```

Requires Python 3 with numpy. `gaps-results.json` holds the results quoted in the main README (7 Nov 2016 – 5 Nov 2026).

**Method notes**
- A gap is the next session's open divided by the previous close, minus 1. A "weekend" is Friday close to Monday open; holiday gaps are counted separately.
- "Share of variance while closed" is Σ gap² ÷ (Σ gap² + Σ intraday²).
- The naive-redemption leak assumes every holder redeems at Friday's close on every down weekend, so it is an upper bound.
- The squeeze model uses a constant-product pool (13,100 tokens at $28.84, as reported for HIMS). Minters sell into the pool whenever its price exceeds fair value by the cap (0.2–1%).
- The issuer's minting profit is an estimate: 18,750 tokens × $28.84 × the average premium as it fell from 93% to 12% (linear or exponential decay).
