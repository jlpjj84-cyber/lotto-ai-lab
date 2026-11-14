const DAY = 86400000;
export const WEEK = 7 * DAY;
export const KST = 9 * 3600000;
export const EPOCH = Date.parse('2002-12-07T00:00:00Z');

export function scheduleFor(round) {
  if (!Number.isInteger(round) || round < 1 || round > 9999) throw Error('유효한 회차가 필요합니다.');
  const date = new Date(EPOCH + (round - 1) * WEEK).toISOString().slice(0, 10);
  return { round, date, cutoffUTC: `${date}T11:00:00.000Z`, opensUTC: `${date}T09:00:00.000Z` };
}

export function roundOnSaturday(now) {
  const local = new Date(now.getTime() + KST);
  const midnight = Date.parse(local.toISOString().slice(0, 10));
  if (local.getUTCDay() !== 6 || midnight < EPOCH) return null;
  return scheduleFor(1 + (midnight - EPOCH) / WEEK);
}
