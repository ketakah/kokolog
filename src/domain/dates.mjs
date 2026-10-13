const LOCAL_DATE_TIME_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/;

function pad(value) {
  return String(value).padStart(2, '0');
}

export function getCurrentUtcOffsetMinutes(date = new Date()) {
  return -date.getTimezoneOffset();
}

export function formatLocalDateTime(date = new Date(), includeSeconds = true) {
  const datePart = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  const timePart = `${pad(date.getHours())}:${pad(date.getMinutes())}`;
  return includeSeconds ? `${datePart}T${timePart}:${pad(date.getSeconds())}` : `${datePart}T${timePart}`;
}

export function normalizeLocalDateTime(value) {
  const parts = parseLocalDateTime(value);
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}T${pad(parts.hour)}:${pad(parts.minute)}:${pad(parts.second)}`;
}

export function parseLocalDateTime(value) {
  const match = LOCAL_DATE_TIME_PATTERN.exec(String(value || ''));
  if (!match) {
    throw new TypeError('記録日時の形式が正しくありません。');
  }

  const parts = {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
    hour: Number(match[4]),
    minute: Number(match[5]),
    second: Number(match[6] || 0),
  };
  const checked = new Date(
    Date.UTC(
      parts.year,
      parts.month - 1,
      parts.day,
      parts.hour,
      parts.minute,
      parts.second,
    ),
  );

  if (
    checked.getUTCFullYear() !== parts.year ||
    checked.getUTCMonth() !== parts.month - 1 ||
    checked.getUTCDate() !== parts.day ||
    checked.getUTCHours() !== parts.hour ||
    checked.getUTCMinutes() !== parts.minute ||
    checked.getUTCSeconds() !== parts.second
  ) {
    throw new TypeError('記録日時として存在しない日付です。');
  }

  return parts;
}

export function localDateTimeToUtcMilliseconds(value, utcOffsetMinutes) {
  const parts = parseLocalDateTime(value);
  if (
    !Number.isInteger(utcOffsetMinutes) ||
    utcOffsetMinutes < -840 ||
    utcOffsetMinutes > 840
  ) {
    throw new TypeError('UTCオフセットが正しくありません。');
  }

  return (
    Date.UTC(
      parts.year,
      parts.month - 1,
      parts.day,
      parts.hour,
      parts.minute,
      parts.second,
    ) -
    utcOffsetMinutes * 60 * 1000
  );
}

export function isFutureLocalDateTime(value, utcOffsetMinutes, now = new Date()) {
  return localDateTimeToUtcMilliseconds(value, utcOffsetMinutes) > now.getTime();
}

export function getLocalDateKey(value) {
  return normalizeLocalDateTime(value).slice(0, 10);
}

export function formatTimelineDate(value, locale = 'ja-JP') {
  const parts = parseLocalDateTime(value);
  const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
  return new Intl.DateTimeFormat(locale, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    weekday: 'short',
    timeZone: 'UTC',
  }).format(date);
}

export function formatRecordDateTime(value, locale = 'ja-JP') {
  const parts = parseLocalDateTime(value);
  const date = new Date(
    Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute),
  );
  return new Intl.DateTimeFormat(locale, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'UTC',
  }).format(date);
}

export function formatRecordTime(value) {
  const parts = parseLocalDateTime(value);
  return `${pad(parts.hour)}:${pad(parts.minute)}`;
}
