import {
  formatLocalDateTime,
  getCurrentUtcOffsetMinutes,
  isFutureLocalDateTime,
  normalizeLocalDateTime,
} from './dates.mjs';
import { isMoodValue } from './moods.mjs';

export const RECORD_SCHEMA_VERSION = 1;
export const MAX_TITLE_LENGTH = 300;
export const MAX_BODY_LENGTH = 100000;
export const MAX_TAGS_PER_RECORD = 100;
export const RECORD_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/;
export const CANONICAL_UTC_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

export class RecordValidationError extends Error {
  constructor(errors) {
    super(errors.join('\n'));
    this.name = 'RecordValidationError';
    this.errors = errors;
  }
}

export function normalizeNewlines(value) {
  return String(value || '').replace(/\r\n?/g, '\n');
}

export function normalizeRecordInput(input) {
  const title = String(input?.title || '').trim();
  const body = normalizeNewlines(input?.body).trimEnd();
  const mood = input?.mood === null || input?.mood === undefined || input?.mood === ''
    ? null
    : Number(input.mood);
  const tagIds = [...new Set(Array.isArray(input?.tagIds) ? input.tagIds : [])]
    .map((tagId) => String(tagId))
    .sort();

  return {
    title,
    body,
    mood,
    tagIds,
    favorite: Boolean(input?.favorite),
    occurredAtLocal: normalizeLocalDateTime(input?.occurredAtLocal),
    occurredUtcOffsetMinutes: Number(input?.occurredUtcOffsetMinutes),
  };
}

export function validateRecordInput(input, options = {}) {
  const now = options.now || new Date();
  const errors = [];
  let normalized;

  try {
    normalized = normalizeRecordInput(input);
  } catch (error) {
    errors.push(error.message);
    return { valid: false, errors, value: null };
  }

  if (normalized.title.length > MAX_TITLE_LENGTH) {
    errors.push(`タイトルは${MAX_TITLE_LENGTH}文字以内にしてください。`);
  }
  if (normalized.body.length > MAX_BODY_LENGTH) {
    errors.push(`本文は${MAX_BODY_LENGTH}文字以内にしてください。`);
  }
  if (normalized.mood !== null && !isMoodValue(normalized.mood)) {
    errors.push('調子は1から5のいずれかを選んでください。');
  }
  if (normalized.tagIds.length > MAX_TAGS_PER_RECORD) {
    errors.push(`タグは${MAX_TAGS_PER_RECORD}件以内にしてください。`);
  }
  if (!normalized.title && !normalized.body.trim() && normalized.mood === null) {
    errors.push('本文、タイトル、調子のいずれかを入力してください。');
  }
  if (
    !Number.isInteger(normalized.occurredUtcOffsetMinutes) ||
    normalized.occurredUtcOffsetMinutes < -840 ||
    normalized.occurredUtcOffsetMinutes > 840
  ) {
    errors.push('記録日時のUTCオフセットが正しくありません。');
  } else if (
    isFutureLocalDateTime(
      normalized.occurredAtLocal,
      normalized.occurredUtcOffsetMinutes,
      now,
    )
  ) {
    errors.push('未来の日時では保存できません。');
  }

  return {
    valid: errors.length === 0,
    errors,
    value: normalized,
  };
}

function randomId() {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }
  if (typeof globalThis.crypto?.getRandomValues !== 'function') {
    throw new Error('安全な記録IDを生成できません。');
  }

  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, '0'));
  return [
    hex.slice(0, 4).join(''),
    hex.slice(4, 6).join(''),
    hex.slice(6, 8).join(''),
    hex.slice(8, 10).join(''),
    hex.slice(10, 16).join(''),
  ].join('-');
}

export function canonicalRecordContent(record) {
  return JSON.stringify({
    title: record.title,
    body: record.body,
    mood: record.mood,
    tagIds: [...new Set(record.tagIds)].sort(),
    favorite: record.favorite,
    occurredAtLocal: record.occurredAtLocal,
    occurredUtcOffsetMinutes: record.occurredUtcOffsetMinutes,
    deletedAt: record.deletedAt,
  });
}

export async function sha256(value) {
  if (!globalThis.crypto?.subtle) {
    throw new Error('この環境では内容ハッシュを計算できません。');
  }
  const bytes = new TextEncoder().encode(value);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

export async function addContentHash(record) {
  return {
    ...record,
    contentHash: `sha256:${await sha256(canonicalRecordContent(record))}`,
  };
}

export async function createRecord(input, options = {}) {
  const now = options.now || new Date();
  const validation = validateRecordInput(input, { now });
  if (!validation.valid) {
    throw new RecordValidationError(validation.errors);
  }

  const timestamp = now.toISOString();
  const record = {
    id: options.id || randomId(),
    schemaVersion: RECORD_SCHEMA_VERSION,
    ...validation.value,
    createdAt: timestamp,
    updatedAt: timestamp,
    deletedAt: null,
    revision: 1,
    contentHash: '',
    source: {
      kind: 'native',
      externalId: null,
    },
  };

  if (!RECORD_ID_PATTERN.test(record.id)) {
    throw new RecordValidationError(['記録IDの形式が正しくありません。']);
  }

  return addContentHash(record);
}

export async function updateRecord(existing, changes, options = {}) {
  if (!existing || !RECORD_ID_PATTERN.test(existing.id || '')) {
    throw new RecordValidationError(['更新対象の記録が正しくありません。']);
  }

  const now = options.now || new Date();
  const mergedInput = {
    title: changes.title ?? existing.title,
    body: changes.body ?? existing.body,
    mood: changes.mood === undefined ? existing.mood : changes.mood,
    tagIds: changes.tagIds ?? existing.tagIds,
    favorite: changes.favorite ?? existing.favorite,
    occurredAtLocal: changes.occurredAtLocal ?? existing.occurredAtLocal,
    occurredUtcOffsetMinutes:
      changes.occurredUtcOffsetMinutes ?? existing.occurredUtcOffsetMinutes,
  };
  const validation = validateRecordInput(mergedInput, { now });
  if (!validation.valid) {
    throw new RecordValidationError(validation.errors);
  }

  return addContentHash({
    ...existing,
    ...validation.value,
    updatedAt: now.toISOString(),
    revision: existing.revision + 1,
  });
}

export function createDefaultRecordInput(now = new Date()) {
  return {
    title: '',
    body: '',
    mood: null,
    tagIds: [],
    favorite: false,
    occurredAtLocal: formatLocalDateTime(now),
    occurredUtcOffsetMinutes: getCurrentUtcOffsetMinutes(now),
  };
}

export function validatePersistedRecord(record) {
  const errors = [];
  if (!record || typeof record !== 'object' || Array.isArray(record)) {
    return { valid: false, errors: ['記録がオブジェクトではありません。'] };
  }
  if (!RECORD_ID_PATTERN.test(record.id || '')) {
    errors.push('記録IDの形式が正しくありません。');
  }
  if (record.schemaVersion !== RECORD_SCHEMA_VERSION) {
    errors.push('未対応の記録スキーマです。');
  }
  if (
    typeof record.createdAt !== 'string' ||
    !CANONICAL_UTC_PATTERN.test(record.createdAt) ||
    Number.isNaN(Date.parse(record.createdAt)) ||
    new Date(record.createdAt).toISOString() !== record.createdAt
  ) {
    errors.push('作成日時が正しくありません。');
  }
  if (
    typeof record.updatedAt !== 'string' ||
    !CANONICAL_UTC_PATTERN.test(record.updatedAt) ||
    Number.isNaN(Date.parse(record.updatedAt)) ||
    new Date(record.updatedAt).toISOString() !== record.updatedAt
  ) {
    errors.push('更新日時が正しくありません。');
  } else if (
    CANONICAL_UTC_PATTERN.test(record.createdAt || '') &&
    Date.parse(record.updatedAt) < Date.parse(record.createdAt)
  ) {
    errors.push('更新日時が作成日時より前です。');
  }
  if (!Number.isInteger(record.revision) || record.revision < 1) {
    errors.push('リビジョンが正しくありません。');
  }
  if (!/^sha256:[0-9a-f]{64}$/.test(record.contentHash || '')) {
    errors.push('内容ハッシュが正しくありません。');
  }

  const inputValidation = validateRecordInput(record, {
    now: new Date(Math.max(Date.now(), Date.parse(record.updatedAt) || 0)),
  });
  errors.push(...inputValidation.errors);
  return { valid: errors.length === 0, errors };
}
