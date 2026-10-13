const YEAR_MONTH_PATTERN = /^(\d{4})-(\d{2})$/;
const DATE_KEY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

function pad(value) {
  return String(value).padStart(2, '0');
}

export function parseYearMonth(value) {
  const match = YEAR_MONTH_PATTERN.exec(String(value || ''));
  if (!match) {
    throw new TypeError('年月の形式が正しくありません。');
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (month < 1 || month > 12) {
    throw new TypeError('月は1から12で指定してください。');
  }
  return { year, month };
}

export function formatYearMonth(year, month) {
  return `${year}-${pad(month)}`;
}

export function currentYearMonth(date = new Date()) {
  return formatYearMonth(date.getFullYear(), date.getMonth() + 1);
}

export function shiftYearMonth(value, amount) {
  const { year, month } = parseYearMonth(value);
  const shifted = new Date(Date.UTC(year, month - 1 + amount, 1));
  return formatYearMonth(shifted.getUTCFullYear(), shifted.getUTCMonth() + 1);
}

export function getMonthRange(value) {
  const start = `${value}-01T00:00:00`;
  const end = `${shiftYearMonth(value, 1)}-01T00:00:00`;
  return { start, end };
}

export function getYearRange(year) {
  const numericYear = Number(year);
  if (!Number.isInteger(numericYear) || numericYear < 1 || numericYear > 9999) {
    throw new TypeError('年が正しくありません。');
  }
  return {
    start: `${numericYear}-01-01T00:00:00`,
    end: `${numericYear + 1}-01-01T00:00:00`,
  };
}

export function daysInMonth(value) {
  const { year, month } = parseYearMonth(value);
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function createCalendarCells(value) {
  const { year, month } = parseYearMonth(value);
  const firstDay = new Date(Date.UTC(year, month - 1, 1));
  const mondayOffset = (firstDay.getUTCDay() + 6) % 7;
  const startDate = new Date(Date.UTC(year, month - 1, 1 - mondayOffset));

  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(startDate.getTime() + index * 86400000);
    const cellYear = date.getUTCFullYear();
    const cellMonth = date.getUTCMonth() + 1;
    const day = date.getUTCDate();
    return {
      dateKey: `${cellYear}-${pad(cellMonth)}-${pad(day)}`,
      day,
      inCurrentMonth: cellYear === year && cellMonth === month,
    };
  });
}

export function isValidDateKey(value) {
  const match = DATE_KEY_PATTERN.exec(String(value || ''));
  if (!match) {
    return false;
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

export function formatYearMonthTitle(value) {
  const { year, month } = parseYearMonth(value);
  return `${year}年${month}月`;
}

export function formatDayTitle(dateKey, locale = 'ja-JP') {
  if (!isValidDateKey(dateKey)) {
    throw new TypeError('日付が正しくありません。');
  }
  const [year, month, day] = dateKey.split('-').map(Number);
  return new Intl.DateTimeFormat(locale, {
    month: 'long',
    day: 'numeric',
    weekday: 'short',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(year, month - 1, day)));
}
