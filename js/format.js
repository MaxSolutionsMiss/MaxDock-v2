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
});
