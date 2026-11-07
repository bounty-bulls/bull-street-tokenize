import numpy as np
P0 = 28.84            # HIMS Friday close (verified from price data)
R0 = 13_100           # tokens in the pool (reported)
U0 = R0 * P0          # pool starts at fair value
k = R0 * U0
# 1) frozen supply: weekend buy flow pushes the pool to the reported +112% peak
target = 61.15
R1 = np.sqrt(k / target); U1 = k / R1
spent = U1 - U0; got = R0 - R1
print(f"FROZEN SUPPLY: buy flow ${spent:,.0f} gets {got:,.0f} tokens at avg ${spent/got:.2f} (fair ${P0}); overpaid ${spent - got*P0:,.0f} ({spent/(got*P0)-1:+.0%})")
# 2) Bull Street: pledged spare shares can be minted at any hour; minters sell whenever pool price > P0*(1+c)
for c in (0.002, 0.005, 0.01):
    R, U = R0, U0; tokens = 0.0; minted = 0.0; minter_rev = 0.0
    steps = 20000; dx = spent / steps
    for _ in range(steps):
        # buyer spends dx USDC in the pool
        newU = U + dx; newR = k_ = None
        kk = R * U; nR = kk / newU; tokens += R - nR; R, U = nR, newU
        # minters arbitrage the pool back to the cap
        p = U / R
        cap = P0 * (1 + c)
        if p > cap:
            kk = R * U; Rcap = np.sqrt(kk / cap); add = Rcap - R; got_usdc = U - kk / Rcap
            minted += add; minter_rev += got_usdc; R, U = Rcap, kk / Rcap
    print(f"BULL STREET (cap +{c:.1%}): same ${spent:,.0f} buys {tokens:,.0f} tokens (avg ${spent/tokens:.2f}, {tokens/got-1:+.0%} more than frozen); minters mint {minted:,.0f} and earn ${minter_rev - minted*P0:,.0f} over fair; peak price ${P0*(1+c):.2f}")
# 3) the issuer's AP when minting reopened: 18,750 tokens while the premium fell 93% -> 12%
n = 18_750
lin = np.mean(np.linspace(0.93, 0.12, 1000))
expo = np.mean(0.12 + (0.93 - 0.12) * np.exp(-np.linspace(0, 4, 1000)))
print(f"AP mint after reopening: {n:,} tokens x ${P0} x avg premium {expo:.0%}-{lin:.0%} = ${n*P0*expo:,.0f} - ${n*P0*lin:,.0f}")
