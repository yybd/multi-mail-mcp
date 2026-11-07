// Google Calendar, opt-in per account (`add --calendar`).
// Read events and free/busy across every calendar of every enabled account, and create
// events on your own primary calendar. No invitations are sent, and there is no tool to
// change or delete an event.

import { calendar as calendarApi, type calendar_v3 } from '@googleapis/calendar';
import { hasCalendarScope, listAccounts, resolveAccount, type Account } from './config.js';
import { authFor, friendlyError, mapLimit } from './gmail.js';

const apis = new WeakMap<object, calendar_v3.Calendar>();

function apiFor(acc: Account): calendar_v3.Calendar {
  const auth = authFor(acc);
  let api = apis.get(auth);
  if (!api) {
    api = calendarApi({ version: 'v3', auth });
    apis.set(auth, api);
  }
  return api;
}

async function call<T>(acc: Account, fn: (api: calendar_v3.Calendar) => Promise<T>): Promise<T> {
  if (!hasCalendarScope(acc)) {
    throw new Error(
      `Calendar is not enabled for ${acc.email}. Reconnect it with calendar permission: ` +
        `npx -y @yybd/multi-mail-mcp add ${acc.email} --calendar`
    );
  }
  try {
    return await fn(apiFor(acc));
  } catch (err) {
    throw friendlyError(acc, err);
  }
}

/** The accounts a calendar call covers: one, or every calendar-enabled account for "all". */
function accountsFor(sel: string | undefined): Account[] {
  if (sel?.trim().toLowerCase() === 'all') {
    const accs = listAccounts().filter(hasCalendarScope);
    if (accs.length === 0) {
      throw new Error('No account has calendar enabled. Run: npx -y @yybd/multi-mail-mcp add <account> --calendar');
    }
    return accs;
  }
  if (!sel) {
    const accs = listAccounts().filter(hasCalendarScope);
    if (accs.length === 1) return accs;
  }
  return [resolveAccount(sel)];
}

// ---------- time ----------

const tzCache = new Map<string, string>();

async function timeZoneOf(acc: Account): Promise<string> {
  const hit = tzCache.get(acc.email);
  if (hit) return hit;
  const tz = await call(acc, async (api) => (await api.settings.get({ setting: 'timezone' })).data.value ?? 'UTC');
  tzCache.set(acc.email, tz);
  return tz;
}

/** Minutes that `tz` is ahead of UTC at the instant `utcMs`. */
export function tzOffsetMinutes(tz: string, utcMs: number): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(utcMs));
  const n = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asUtc = Date.UTC(n('year'), n('month') - 1, n('day'), n('hour'), n('minute'), n('second'));
  return Math.round((asUtc - utcMs) / 60000);
}

/**
 * Turn "2026-11-09", "2026-11-09T14:30" (wall time in `tz`) or a full RFC 3339
 * string into an absolute instant.
 */
export function toInstant(input: string, tz: string): Date {
  const s = input.trim();
  if (/[zZ]|[+-]\d\d:?\d\d$/.test(s)) {
    const d = new Date(s);
    if (isNaN(d.getTime())) throw new Error(`Not a valid time: "${input}"`);
    return d;
  }
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?$/);
  if (!m) throw new Error(`Not a valid time: "${input}". Use 2026-11-09 or 2026-11-09T14:30.`);
  const wall = Date.UTC(+m[1], +m[2] - 1, +m[3], +(m[4] ?? 0), +(m[5] ?? 0), +(m[6] ?? 0));
  // Two passes settle the offset across a DST change.
  let utc = wall - tzOffsetMinutes(tz, wall) * 60000;
  utc = wall - tzOffsetMinutes(tz, utc) * 60000;
  return new Date(utc);
}

/** RFC 3339 in `tz`, e.g. 2026-11-09T14:30:00+02:00 — readable for the model and the user. */
export function formatInTz(d: Date, tz: string): string {
  const off = tzOffsetMinutes(tz, d.getTime());
  const local = new Date(d.getTime() + off * 60000).toISOString().slice(0, 19);
  const sign = off >= 0 ? '+' : '-';
  const a = Math.abs(off);
  return `${local}${sign}${String(Math.floor(a / 60)).padStart(2, '0')}:${String(a % 60).padStart(2, '0')}`;
}

// ---------- events ----------

async function visibleCalendars(acc: Account): Promise<calendar_v3.Schema$CalendarListEntry[]> {
  return call(acc, async (api) => {
    const items = (await api.calendarList.list({ minAccessRole: 'reader', maxResults: 250 })).data.items ?? [];
    // The calendars ticked in Google Calendar's sidebar, plus the primary one.
    return items.filter((c) => c.primary || c.selected);
  });
}

export interface EventOut {
  account: string;
  calendar: string;
  id: string;
  summary: string;
  start: string;
  end: string;
  allDay: boolean;
  location?: string;
  organizer?: string;
  attendees?: number;
  myResponse?: string;
  status?: string;
  link?: string;
  description?: string;
}

export async function listEvents(
  accountSel: string | undefined,
  from: string,
  to: string,
  query: string | undefined,
  maxResults: number
) {
  const accounts = accountsFor(accountSel);
  const tz = await timeZoneOf(accounts[0]);
  const timeMin = toInstant(from, tz).toISOString();
  const timeMax = toInstant(to, tz).toISOString();
  const errors: string[] = [];
  const perAccount = await Promise.all(
    accounts.map(async (acc) => {
      try {
        const cals = await visibleCalendars(acc);
        const lists = await mapLimit(cals, 5, (cal) =>
          call(acc, async (api) => {
            const r = await api.events.list({
              calendarId: cal.id!,
              timeMin,
              timeMax,
              q: query || undefined,
              singleEvents: true,
              orderBy: 'startTime',
              maxResults: Math.min(250, maxResults),
            });
            return (r.data.items ?? [])
              .filter((e) => e.status !== 'cancelled')
              .map((e): EventOut => {
                const allDay = !e.start?.dateTime;
                const me = e.attendees?.find((a) => a.self);
                return {
                  account: acc.email,
                  calendar: cal.summaryOverride ?? cal.summary ?? cal.id!,
                  id: e.id ?? '',
                  summary: e.summary ?? '(no title)',
                  start: allDay ? e.start?.date ?? '' : formatInTz(new Date(e.start!.dateTime!), tz),
                  end: allDay ? e.end?.date ?? '' : formatInTz(new Date(e.end!.dateTime!), tz),
                  allDay,
                  location: e.location ?? undefined,
                  organizer: e.organizer?.self ? undefined : e.organizer?.email ?? undefined,
                  attendees: e.attendees?.length || undefined,
                  myResponse: me?.responseStatus ?? undefined,
                  status: e.status === 'tentative' ? 'tentative' : undefined,
                  link: e.htmlLink ?? undefined,
                  description: e.description ? e.description.slice(0, 500) : undefined,
                };
              });
          })
        );
        return lists.flat();
      } catch (e) {
        errors.push((e as Error).message);
        return [];
      }
    })
  );
  if (errors.length === accounts.length) throw new Error(errors.join('\n'));
  const events = perAccount
    .flat()
    .sort((a, b) => toInstant(a.start, tz).getTime() - toInstant(b.start, tz).getTime())
    .slice(0, maxResults);
  return { timeZone: tz, from: formatInTz(new Date(timeMin), tz), to: formatInTz(new Date(timeMax), tz), events, ...(errors.length ? { errors } : {}) };
}

// ---------- free time ----------

interface Interval {
  start: number;
  end: number;
}

/** Merge overlapping busy intervals (ms). */
export function mergeBusy(busy: Interval[]): Interval[] {
  const sorted = [...busy].sort((a, b) => a.start - b.start);
  const out: Interval[] = [];
  for (const b of sorted) {
    const last = out[out.length - 1];
    if (last && b.start <= last.end) last.end = Math.max(last.end, b.end);
    else out.push({ ...b });
  }
  return out;
}

/**
 * Free windows of at least `minutes`, inside working hours on the allowed weekdays.
 * Pure, so it can be tested without Google.
 */
export function freeSlots(
  busy: Interval[],
  range: Interval,
  tz: string,
  opts: { minutes: number; dayStart: string; dayEnd: string; weekdays: number[]; maxSlots: number }
): Interval[] {
  const merged = mergeBusy(busy);
  const need = opts.minutes * 60000;
  const slots: Interval[] = [];
  const [sh, sm] = opts.dayStart.split(':').map(Number);
  const [eh, em] = opts.dayEnd.split(':').map(Number);
  // Walk day by day in the calendar's time zone.
  const first = formatInTz(new Date(range.start), tz).slice(0, 10);
  let day = new Date(`${first}T12:00:00Z`);
  while (slots.length < opts.maxSlots) {
    const ymd = day.toISOString().slice(0, 10);
    const dayStartMs = toInstant(`${ymd}T${String(sh).padStart(2, '0')}:${String(sm).padStart(2, '0')}`, tz).getTime();
    if (dayStartMs >= range.end) break;
    const weekday = new Date(`${ymd}T12:00:00Z`).getUTCDay();
    if (opts.weekdays.includes(weekday)) {
      const dayEndMs = toInstant(`${ymd}T${String(eh).padStart(2, '0')}:${String(em).padStart(2, '0')}`, tz).getTime();
      let cursor = Math.max(dayStartMs, range.start);
      const limit = Math.min(dayEndMs, range.end);
      for (const b of merged) {
        if (b.end <= cursor) continue;
        if (b.start >= limit) break;
        if (b.start - cursor >= need) slots.push({ start: cursor, end: b.start });
        cursor = Math.max(cursor, b.end);
        if (slots.length >= opts.maxSlots) break;
      }
      if (slots.length < opts.maxSlots && limit - cursor >= need) slots.push({ start: cursor, end: limit });
    }
    day = new Date(day.getTime() + 86400000);
  }
  return slots.slice(0, opts.maxSlots);
}

export async function findFreeTime(
  accountSel: string | undefined,
  from: string,
  to: string,
  opts: { minutes: number; dayStart: string; dayEnd: string; weekdays: number[]; maxSlots: number }
) {
  const accounts = accountsFor(accountSel);
  const tz = await timeZoneOf(accounts[0]);
  const range = { start: toInstant(from, tz).getTime(), end: toInstant(to, tz).getTime() };
  if (range.end <= range.start) throw new Error('"to" must be after "from".');
  if (range.end - range.start > 62 * 86400000) throw new Error('Ask for at most about two months at a time.');
  const busy: Interval[] = [];
  const checked: string[] = [];
  for (const acc of accounts) {
    const cals = await visibleCalendars(acc);
    await call(acc, async (api) => {
      const r = await api.freebusy.query({
        requestBody: {
          timeMin: new Date(range.start).toISOString(),
          timeMax: new Date(range.end).toISOString(),
          items: cals.map((c) => ({ id: c.id! })),
        },
      });
      for (const [id, cal] of Object.entries(r.data.calendars ?? {})) {
        if (cal.errors?.length) continue;
        checked.push(`${acc.email}: ${cals.find((c) => c.id === id)?.summary ?? id}`);
        for (const b of cal.busy ?? []) busy.push({ start: Date.parse(b.start!), end: Date.parse(b.end!) });
      }
    });
  }
  const slots = freeSlots(busy, range, tz, opts);
  return {
    timeZone: tz,
    calendarsChecked: checked,
    free: slots.map((s) => ({ start: formatInTz(new Date(s.start), tz), end: formatInTz(new Date(s.end), tz), minutes: Math.round((s.end - s.start) / 60000) })),
  };
}

// ---------- create ----------

export async function createEvent(
  accountSel: string | undefined,
  e: { summary: string; start: string; end?: string; minutes?: number; description?: string; location?: string; allDay?: boolean }
) {
  const [acc] = accountsFor(accountSel);
  const tz = await timeZoneOf(acc);
  let start: calendar_v3.Schema$EventDateTime;
  let end: calendar_v3.Schema$EventDateTime;
  if (e.allDay) {
    const s = e.start.slice(0, 10);
    const endDay = e.end ? e.end.slice(0, 10) : new Date(Date.parse(`${s}T12:00:00Z`) + 86400000).toISOString().slice(0, 10);
    start = { date: s };
    end = { date: endDay };
  } else {
    const s = toInstant(e.start, tz);
    const en = e.end ? toInstant(e.end, tz) : new Date(s.getTime() + (e.minutes ?? 60) * 60000);
    if (en <= s) throw new Error('The end must be after the start.');
    start = { dateTime: formatInTz(s, tz), timeZone: tz };
    end = { dateTime: formatInTz(en, tz), timeZone: tz };
  }
  return call(acc, async (api) => {
    const r = await api.events.insert({
      calendarId: 'primary',
      sendUpdates: 'none',
      requestBody: { summary: e.summary, description: e.description, location: e.location, start, end },
    });
    return {
      created: true,
      account: acc.email,
      id: r.data.id,
      summary: r.data.summary,
      start: r.data.start?.dateTime ?? r.data.start?.date,
      end: r.data.end?.dateTime ?? r.data.end?.date,
      link: r.data.htmlLink,
      note: 'Created on your own calendar only; nobody was invited.',
    };
  });
}
