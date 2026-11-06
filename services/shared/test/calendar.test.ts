import { describe, expect, it } from "vitest";
import { COMPRESSED, isTradingDay, nextSessions } from "../src/calendar";

// Friday 2026-11-06 12:00 IST
const FRI_NOON = Date.UTC(2026, 10, 6, 6, 30) / 1000;

describe("nse calendar", () => {
  it("bootstraps from the last closed session and skips weekends and holidays", () => {
    const s = nextSessions("nse", undefined, 4, FRI_NOON);
    // Friday's session is still open at noon, so the bootstrap is Thursday 2026-11-05
    expect(new Date((s[0].open + 19800) * 1000).toISOString().slice(0, 10)).toBe("2026-11-05");
    const days = s.map((x) => new Date((x.open + 19800) * 1000).toISOString().slice(0, 10));
    // 2026-11-10 is a holiday (Diwali Balipratipada)
    expect(days).toEqual(["2026-11-05", "2026-11-06", "2026-11-09", "2026-11-11"]);
    expect(s.map((x) => x.index)).toEqual([0, 1, 2, 3]);
    expect(s[1].close - s[1].open).toBe(6 * 3600 + 15 * 60);
  });

  it("continues contiguously after the last posted session", () => {
    const first = nextSessions("nse", undefined, 2, FRI_NOON);
    const more = nextSessions("nse", first[1], 2, FRI_NOON);
    expect(more[0].index).toBe(2);
    expect(more[0].open).toBeGreaterThan(first[1].close);
  });

  it("knows trading days", () => {
    expect(isTradingDay(FRI_NOON)).toBe(true);
    expect(isTradingDay(FRI_NOON + 86400)).toBe(false);
  });
});

describe("compressed calendar", () => {
  it("bootstraps with a session that already closed and adds a weekend after every fifth", () => {
    const s = nextSessions("compressed", undefined, 7, 1_000_000);
    expect(s[0].close).toBeLessThan(1_000_000);
    expect(s[1].open - s[0].close).toBe(COMPRESSED.gap);
    expect(s[5].open - s[4].close).toBe(COMPRESSED.weekend);
    expect(s[6].open - s[5].close).toBe(COMPRESSED.gap);
    expect(s.every((x) => x.close - x.open === COMPRESSED.open)).toBe(true);
  });
});
