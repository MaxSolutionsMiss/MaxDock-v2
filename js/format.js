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

  addDaysInput(value, days, location) {
    const date = makeDate(value);
    date.setUTCDate(date.getUTCDate() + Number(days || 0));
    return this.inputDate(date, location);
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

  longDateInput(dateInput, location) {
    return new Intl.DateTimeFormat('en-CA', {
      weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
      timeZone: location?.timezone || DEFAULT_TIMEZONE,
    }).format(makeDate(`${dateInput}T12:00:00Z`));
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
