import holidaysJson from "./data/nse-holidays.json" with { type: "json" };

/**
 * Session calendars posted to SessionClock.
 *
 * - "nse": real NSE equity sessions, 09:15-15:30 IST on weekdays that are not exchange holidays.
 * - "compressed": 10-minute sessions with 20-minute gaps and an 80-minute "weekend" after every fifth
 *   session, so a full redemption cycle (cure, soft and hard deadlines) plays out in a couple of hours.
 */
export type CalendarMode = "nse" | "compressed";

export interface Session {
  index: number;
  open: number; // unix seconds
  close: number;
}

const IST_OFFSET = 330 * 60;
const OPEN_IST = 9 * 3600 + 15 * 60;
const CLOSE_IST = 15 * 3600 + 30 * 60;
const HOLIDAYS = new Set<string>(holidaysJson.holidays);

export const COMPRESSED = { open: 10 * 60, gap: 20 * 60, weekend: 80 * 60, perWeek: 5 } as const;

function istDate(unix: number): string {
  return new Date((unix + IST_OFFSET) * 1000).toISOString().slice(0, 10);
}

export function isTradingDay(unix: number): boolean {
  const d = new Date((unix + IST_OFFSET) * 1000);
  const dow = d.getUTCDay();
  return dow !== 0 && dow !== 6 && !HOLIDAYS.has(istDate(unix));
}

/** Midnight IST (as unix seconds) of the IST day containing `unix`. */
function istMidnight(unix: number): number {
  return Math.floor((unix + IST_OFFSET) / 86400) * 86400 - IST_OFFSET;
}

function nseSessionOn(dayStart: number): { open: number; close: number } {
  return { open: dayStart + OPEN_IST, close: dayStart + CLOSE_IST };
}

/**
 * The next `count` sessions after `last` (or, when nothing is posted yet, starting with the most recent
 * session that has already closed, so a price can be posted for it right away).
 */
export function nextSessions(mode: CalendarMode, last: Session | undefined, count: number, now: number): Session[] {
  const out: Session[] = [];
  if (mode === "compressed") {
    let prev: Session;
    if (last) {
      prev = last;
    } else {
      // bootstrap: one session that closed a minute ago, then the cycle continues
      const close = now - 60;
      prev = { index: 0, open: close - COMPRESSED.open, close };
      out.push(prev);
    }
    while (out.length < count) {
      const gap = (prev.index + 1) % COMPRESSED.perWeek === 0 ? COMPRESSED.weekend : COMPRESSED.gap;
      const open = prev.close + gap;
      const s: Session = { index: prev.index + 1, open, close: open + COMPRESSED.open };
      out.push(s);
      prev = s;
    }
    return out.slice(0, count);
  }

  let day: number;
  let index: number;
  if (last) {
    day = istMidnight(last.open) + 86400;
    index = last.index + 1;
  } else {
    // most recent trading day whose session has closed
    day = istMidnight(now);
    while (!isTradingDay(day + 43200) || nseSessionOn(day).close > now) day -= 86400;
    index = 0;
  }
  while (out.length < count) {
    if (isTradingDay(day + 43200)) {
      const s = nseSessionOn(day);
      out.push({ index: index++, open: s.open, close: s.close });
    }
    day += 86400;
  }
  return out;
}

export function sessionState(sessions: Session[], now: number): { open: boolean; current?: Session; next?: Session } {
  const current = sessions.find((s) => s.open <= now && now < s.close);
  const next = sessions.find((s) => s.open > now);
  return { open: !!current, current, next };
}

export function untilLabel(seconds: number): string {
  if (seconds <= 0) return "now";
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${Math.max(m, 1)}m`;
}
