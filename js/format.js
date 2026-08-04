const DEFAULT_TIMEZONE = 'America/Toronto';

function makeDate(value) {
  if (value instanceof Date) return value;
  if (!value) return new Date();
  return new Date(value);
}

export const format = Object.freeze({
  time(value, location) {
    return new Intl.DateTimeFormat('en-CA', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      timeZone: location?.timezone || DEFAULT_TIMEZONE,
    }).format(makeDate(value));
  },

  date(value, location) {
    return new Intl.DateTimeFormat('en-CA', {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      timeZone: location?.timezone || DEFAULT_TIMEZONE,
    }).format(makeDate(value));
  },

  timestamp(value, location) {
    return `${this.date(value, location)} · ${this.time(value, location)}`;
  },

  inputDate(value, location) {
    const parts = new Intl.DateTimeFormat('en-CA', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      timeZone: location?.timezone || DEFAULT_TIMEZONE,
    }).formatToParts(makeDate(value));
    const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
    return `${values.year}-${values.month}-${values.day}`;
  },

  // Minutes since midnight at the site, which is what the board's timeline is measured in.
  // Derived from inputTime rather than from getHours so it follows the site's timezone: a
  // coordinator in Ontario looking at Langley must see Langley's "now", not their own.
  minutesOfDay(value, location) {
    const [hours, minutes] = this.inputTime(value, location).split(':').map(Number);
    return (Number.isFinite(hours) ? hours : 0) * 60 + (Number.isFinite(minutes) ? minutes : 0);
  },

  inputTime(value, location) {
    const parts = new Intl.DateTimeFormat('en-CA', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      timeZone: location?.timezone || DEFAULT_TIMEZONE,
    }).formatToParts(makeDate(value));
    const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
    return `${values.hour}:${values.minute}`;
  },

  // Calendar arithmetic, not instant arithmetic. A date input is a calendar day,
  // but `new Date('2026-07-20')` is UTC midnight — which is still the 19th in every
  // North American zone. Adding a day to that instant and reformatting it in the
  // location's zone returned the same date, so the board's forward button did
  // nothing and the back button skipped two days. Stepping the components keeps
  // the result independent of the zone, which is what a calendar day should be.
  // A full ISO timestamp is accepted and read as the calendar day it starts on:
  // a caller that hands over `2026-07-27T12:00:00Z` used to get its own string
  // back unchanged, which is how the Reports range start came up blank.
  addDaysInput(value, days) {
    const [year, month, day] = String(value || '').slice(0, 10).split('-').map(Number);
    if (!year || !month || !day) return String(value || '');
    const stepped = new Date(Date.UTC(year, month - 1, day + Number(days || 0)));
    const pad = number => String(number).padStart(2, '0');
    return `${stepped.getUTCFullYear()}-${pad(stepped.getUTCMonth() + 1)}-${pad(stepped.getUTCDate())}`;
  },

  todayInput(location) {
    return this.inputDate(new Date(), location);
  },

  // The calendar year at a location right now. In the site's own zone, because on
  // New Year's Eve a Langley screen and a Bristol screen are not in the same year.
  yearOf(location) {
    return Number(this.todayInput(location).slice(0, 4));
  },

  // The calendar dates a repeating booking lands on: the weekdays chosen, every
  // Nth week counted from the week the first date falls in. All of it is done on
  // date strings through addDaysInput, which steps in UTC — a week is not always
  // 604800000 milliseconds, and dividing by that number puts an appointment on
  // the wrong day twice a year.
  repeatingDates({ from, until, days, intervalWeeks = 1, limit = 60 }) {
    const wanted = new Set((days || []).map(Number));
    const start = String(from || '').slice(0, 10);
    const end = String(until || '').slice(0, 10);
    if (!start || !end || !wanted.size || end < start) return [];
    const interval = Math.max(1, Number(intervalWeeks) || 1);
    const firstDow = this.dayOfWeek(start);
    const dates = [];
    for (let offset = 0; offset <= 366 && dates.length < limit; offset += 1) {
      const cursor = this.addDaysInput(start, offset);
      if (cursor > end) break;
      // Offset plus the first date's weekday is how many days into that week the
      // cursor sits, so integer division by seven is the week number exactly.
      if (wanted.has(this.dayOfWeek(cursor)) && Math.floor((offset + firstDow) / 7) % interval === 0) {
        dates.push(cursor);
      }
    }
    return dates;
  },

  dayOfWeek(dateInput) {
    const [year, month, day] = String(dateInput || '').split('-').map(Number);
    return new Date(Date.UTC(year, Math.max(0, (month || 1) - 1), day || 1, 12)).getUTCDay();
  },

  clockMinutes(value) {
    const [hour, minute] = String(value || '00:00').split(':').map(Number);
    return Number(hour || 0) * 60 + Number(minute || 0);
  },

  localTimeMinutes(value, location) {
    return this.clockMinutes(this.inputTime(value, location));
  },

  minutesBetween(start, end) {
    return Math.max(0, (this.epoch(end) - this.epoch(start)) / 60000);
  },

  // A span of time as a person says it: "90 minutes" is how long the door is
  // held, but "1 h 30 min" is what a shipping office schedules around. Always
  // carries its units, never a bare number.
  // How long a shift is, in hours, from two clock times. A shift that ends earlier
  // than it starts crosses midnight and is measured forward — 22:00 to 06:00 is
  // eight hours, not minus sixteen. Lives here because clock arithmetic belongs in
  // one place, and the server works this out the same way.
  shiftHours(startTime, endTime) {
    const minutes = value => {
      const [hours, mins] = String(value || '').split(':').map(Number);
      return (Number.isFinite(hours) ? hours : 0) * 60 + (Number.isFinite(mins) ? mins : 0);
    };
    const span = minutes(endTime) - minutes(startTime);
    return (span > 0 ? span : span + 1440) / 60;
  },

  duration(minutes) {
    const total = Math.max(0, Math.round(Number(minutes) || 0));
    const hours = Math.floor(total / 60);
    const rest = total % 60;
    if (!hours) return `${rest} min`;
    return rest ? `${hours} h ${rest} min` : `${hours} h`;
  },

  longDateInput(dateInput, location) {
    return new Intl.DateTimeFormat('en-CA', {
      weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
      timeZone: location?.timezone || DEFAULT_TIMEZONE,
    }).format(makeDate(`${dateInput}T12:00:00Z`));
  },

  // "27 Jul 2026" — short enough for a subtitle, unambiguous about the month,
  // and never a bare ISO string in front of an operator.
  // Weekday and day and month, no year. In a list of bookings a few weeks either
  // side of today the year is four characters of nothing, and the row it sits on
  // has to hold a reference, a route and a time on one line.
  dateShort(value, location) {
    return new Intl.DateTimeFormat('en-CA', {
      weekday: 'short', day: 'numeric', month: 'short',
      timeZone: location?.timezone || DEFAULT_TIMEZONE,
    }).format(makeDate(value));
  },

  shortDateInput(dateInput, location) {
    return new Intl.DateTimeFormat('en-CA', {
      month: 'short', day: 'numeric', year: 'numeric',
      timeZone: location?.timezone || DEFAULT_TIMEZONE,
    }).format(makeDate(`${String(dateInput).slice(0, 10)}T12:00:00Z`));
  },

  currentTimeLabel() {
    return new Intl.DateTimeFormat('en-CA', {
      hour: 'numeric', minute: '2-digit', second: '2-digit',
    }).format(new Date());
  },

  sameLocalDate(value, dateInput, location) {
    return this.inputDate(value, location) === String(dateInput || '');
  },

  epoch(value) {
    return makeDate(value).getTime();
  },

  compareChronologically(left, right) {
    return this.epoch(left) - this.epoch(right);
  },

  nowIso() {
    return new Date().toISOString();
  },

  // A moment a number of minutes from now, and whether a timestamp has reached
  // it. A quick code that books its own time needs both — "no earlier than four
  // hours from now" — and both are date arithmetic, which lives here.
  afterNow(minutes) {
    return new Date(Date.now() + Math.max(0, Number(minutes) || 0) * 60000).toISOString();
  },

  isAtOrAfter(value, moment) {
    return this.epoch(value) >= this.epoch(moment);
  },

  nowEpoch() {
    return Date.now();
  },

  initials(name = '') {
    const parts = String(name).trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return 'MD';
    return `${parts[0][0] || ''}${parts[1]?.[0] || ''}`.toUpperCase();
  },

  role(name = '') {
    return String(name)
      .replaceAll('_', ' ')
      .replace(/\b\w/g, letter => letter.toUpperCase());
  },

  // What a load's status says at the end that is reading it.
  //
  // A Max-to-Max movement is one appointment row holding both ends, and list_location_schedule
  // mirrors it onto the counterpart's board with the direction flipped and is_linked_movement
  // set. The status came across unchanged, and that was wrong in a way nobody had named: the
  // moment Mississauga finished loading, Guelph's board called the truck "Completed" -- a load
  // still standing in another yard, described to the site waiting for it as finished.
  //
  // Completed belongs to the end that did the work. To the other end the same row means the
  // truck is coming, and departed_at is what says it has actually set off. No new column and no
  // new status: both facts were already on the row, read from the wrong side.
  movementStatus(record = {}) {
    const status = String(record.status || '');
    // A load that was cancelled or never turned up is that to everybody.
    if (status === 'cancelled' || status === 'no_show') return this.role(status);

    // An outbound load that is complete has been put on a truck and sent. Somebody scans it as
    // the truck pulls away, so "completed" on an outbound means gone, not finished-and-parked,
    // and En route is what it is until the other end takes it in. This holds on the shipping
    // site's own board too: their part is over, but the load is not sitting in their yard.
    if (status === 'completed' && String(record.direction || '') === 'outbound') return 'En route';

    if (!record.is_linked_movement) return this.role(status);

    // The mirrored leg of a Max-to-Max movement, read by the site waiting for it. The row is
    // the same one the shipping site wrote, with the direction flipped, so its status is the
    // other end's word for what happened -- and completed there means they shipped it, not that
    // it arrived here. This read "Received" for a moment while I was writing it, which is the
    // exact lie this whole change exists to stop: a truck on the road, reported to the site
    // waiting for it as already in.
    if (status === 'completed') return 'En route';
    if (status === 'in_progress') return 'Loading';
    return 'Expected';
  },

  // The same distinction as a status code, so a colour can follow it. En route is its own
  // thing rather than borrowing the completed green, which would say arrived.
  movementStatusCode(record = {}) {
    const status = String(record.status || '');
    if (status === 'cancelled' || status === 'no_show') return status;
    // En route is its own state and must not borrow the completed colour, which says arrived.
    if (status === 'completed' && String(record.direction || '') === 'outbound') return 'in_progress';
    if (!record.is_linked_movement) return status;
    if (status === 'completed') return 'in_progress';
    if (status === 'in_progress') return 'arrived';
    return 'scheduled';
  },
});
