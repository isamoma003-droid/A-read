// Minutes since midnight of `date` in the given IANA time zone.
export function minutesInZone(date, timeZone) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
      .formatToParts(date)
      .map((p) => [p.type, p.value]),
  );
  return Number(parts.hour) * 60 + Number(parts.minute);
}

const toMinutes = (hhmm) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

// True when `minutes` falls inside [from, to). A window ending before it starts wraps past midnight
// (e.g. 20:00–02:00); no window, or from === to, means all day.
export function inDailyWindow(from, to, minutes) {
  if (!from || !to || from === to) return true;
  const start = toMinutes(from);
  const end = toMinutes(to);
  return start < end ? minutes >= start && minutes < end : minutes >= start || minutes < end;
}
