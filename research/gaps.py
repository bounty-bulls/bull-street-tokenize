import json, sys, datetime as dt, numpy as np
D = sys.argv[1]
def load(name):
    j = json.load(open(f"{D}/{name}.json"))["chart"]["result"][0]
    q = j["indicators"]["quote"][0]
    rows = []
    for t, o, c in zip(j["timestamp"], q["open"], q["close"]):
        if o is None or c is None or o <= 0 or c <= 0: continue
        d = dt.datetime.utcfromtimestamp(t + 19800).date()  # IST
        rows.append((d, o, c))
    return rows
out = {}
for name in ["_NSEI", "RELIANCE_NS", "TCS_NS", "INFY_NS", "HDFCBANK_NS", "ICICIBANK_NS", "HINDUNILVR_NS"]:
    r = load(name)
    # drop rows where open == previous close exactly (missing open data)
    ov, wk, hol, intra, cc_wk = [], [], [], [], []
    events = []
    for (d0, o0, c0), (d1, o1, c1) in zip(r, r[1:]):
        if abs(o1 / c0 - 1) < 1e-9: continue
        g = o1 / c0 - 1
        intra.append(c1 / o1 - 1)
        days = (d1 - d0).days
        if days == 1: ov.append(g)
        elif d0.weekday() == 4 and d1.weekday() == 0 and days == 3: wk.append(g); cc_wk.append(c1/c0-1); events.append((abs(g), g, d0, d1))
        else: hol.append(g)
    a = lambda x: np.abs(np.array(x))
    W = np.array(wk); O = np.array(ov); I = np.array(intra); Hh = np.array(hol)
    gaps_all = np.concatenate([O, W, Hh])
    var_close = np.sum(gaps_all**2); var_open = np.sum(I**2)
    events.sort(reverse=True)
    out[name] = dict(
        years=f"{r[0][0]}..{r[-1][0]}", n_weekends=len(W), n_overnight=len(O), n_holiday=len(Hh),
        wk_mean_abs=a(W).mean()*100, wk_median_abs=np.median(a(W))*100, wk_p90=np.percentile(a(W),90)*100, wk_p99=np.percentile(a(W),99)*100,
        wk_gt1=(a(W)>0.01).mean()*100, wk_gt2=(a(W)>0.02).mean()*100, wk_gt3=(a(W)>0.03).mean()*100,
        ov_mean_abs=a(O).mean()*100, hol_mean_abs=a(Hh).mean()*100 if len(Hh) else 0,
        share_of_variance_while_closed=var_close/(var_close+var_open)*100,
        naive_redeem_leak_per_year=np.sum(np.clip(-W,0,None))/ (len(W)/52) *100,  # % of float per year if redemptions priced at Friday close & everyone redeems on down weekends
        top=[(str(d0),str(d1),round(g*100,2)) for _,g,d0,d1 in events[:5]],
    )
for k,v in out.items():
    print(f"\n== {k} {v['years']}  weekends={v['n_weekends']} overnights={v['n_overnight']} holiday-gaps={v['n_holiday']}")
    print(f"  weekend |gap|: mean {v['wk_mean_abs']:.2f}%  median {v['wk_median_abs']:.2f}%  p90 {v['wk_p90']:.2f}%  p99 {v['wk_p99']:.2f}%")
    print(f"  weekends >1%: {v['wk_gt1']:.0f}%  >2%: {v['wk_gt2']:.0f}%  >3%: {v['wk_gt3']:.1f}%   overnight mean |gap| {v['ov_mean_abs']:.2f}%  holiday {v['hol_mean_abs']:.2f}%")
    print(f"  share of price variance that happens while NSE is closed: {v['share_of_variance_while_closed']:.0f}%")
    print(f"  naive Friday-close redemption leak: {v['naive_redeem_leak_per_year']:.1f}% of float per year")
    print(f"  biggest weekend gaps: {v['top']}")
json.dump(out, open(f"{D}/gaps.json","w"), default=str, indent=1)
