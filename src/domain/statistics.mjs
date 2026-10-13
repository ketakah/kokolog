import { getLocalDateKey } from './dates.mjs';
import { isMoodValue } from './moods.mjs';

function roundOne(value) {
  return Math.round(value * 10) / 10;
}

export function calculateDailyMoodAverages(records) {
  const grouped = new Map();

  for (const record of records) {
    if (record.deletedAt !== null || !isMoodValue(record.mood)) {
      continue;
    }
    const dateKey = getLocalDateKey(record.occurredAtLocal);
    const values = grouped.get(dateKey) || [];
    values.push(record.mood);
    grouped.set(dateKey, values);
  }

  return [...grouped.entries()]
    .map(([date, values]) => ({
      date,
      average: roundOne(values.reduce((sum, value) => sum + value, 0) / values.length),
      moodRecordCount: values.length,
    }))
    .sort((left, right) => left.date.localeCompare(right.date));
}

export function calculateMonthMoodSummary(records, yearMonth) {
  const monthRecords = records.filter(
    (record) =>
      record.deletedAt === null && record.occurredAtLocal.startsWith(`${yearMonth}-`),
  );
  const daily = calculateDailyMoodAverages(monthRecords);
  const average =
    daily.length === 0
      ? null
      : roundOne(daily.reduce((sum, day) => sum + day.average, 0) / daily.length);

  return {
    yearMonth,
    average,
    moodDays: daily.length,
    moodRecordCount: monthRecords.filter((record) => isMoodValue(record.mood)).length,
    recordCount: monthRecords.length,
    daily,
  };
}

export function calculateYearMoodSummary(records, year) {
  const yearText = String(year);
  const yearRecords = records.filter(
    (record) =>
      record.deletedAt === null && record.occurredAtLocal.startsWith(`${yearText}-`),
  );
  const daily = calculateDailyMoodAverages(yearRecords);
  const average =
    daily.length === 0
      ? null
      : roundOne(daily.reduce((sum, day) => sum + day.average, 0) / daily.length);
  const months = Array.from({ length: 12 }, (_, index) =>
    calculateMonthMoodSummary(yearRecords, `${yearText}-${String(index + 1).padStart(2, '0')}`),
  );

  return {
    year: Number(year),
    average,
    moodDays: daily.length,
    moodMonths: months.filter((month) => month.average !== null).length,
    moodRecordCount: yearRecords.filter((record) => isMoodValue(record.mood)).length,
    recordCount: yearRecords.length,
    daily,
    months,
  };
}
