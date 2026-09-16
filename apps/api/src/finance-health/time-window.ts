export function getUserMonthWindow(now: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: 'numeric',
  }).formatToParts(now);
  const year = Number(parts.find((part) => part.type === 'year')?.value);
  const month = Number(parts.find((part) => part.type === 'month')?.value);
  return {
    start: zonedDateToUtc(year, month - 1, 1, timezone),
    end: zonedDateToUtc(month === 12 ? year + 1 : year, month === 12 ? 0 : month, 1, timezone),
  };
}

function zonedDateToUtc(year: number, month: number, day: number, timezone: string) {
  const localGuess = Date.UTC(year, month, day);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(new Date(localGuess));
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? 0);
  const representedUtc = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    get('hour') % 24,
    get('minute'),
    get('second'),
  );
  return new Date(localGuess - (representedUtc - localGuess));
}
