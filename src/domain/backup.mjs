import {
  canonicalRecordContent,
  RECORD_ID_PATTERN,
  sha256,
  validatePersistedRecord,
} from './record.mjs';

export const BACKUP_FORMAT = 'kokolog-backup';
export const BACKUP_SCHEMA_VERSION = 1;
export const MAX_BACKUP_BYTES = 25 * 1024 * 1024;
export const MAX_BACKUP_RECORDS = 50000;
export const MAX_BACKUP_TAGS = 5000;
export const MAX_BACKUP_REVISIONS = 500000;
export const MAX_BACKUP_TOMBSTONES = 100000;

const UTC_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const HASH_PATTERN = /^sha256:[0-9a-f]{64}$/;

function isValidUtc(value) {
  return (
    typeof value === 'string' &&
    UTC_PATTERN.test(value) &&
    !Number.isNaN(Date.parse(value)) &&
    new Date(value).toISOString() === value
  );
}

function validateCollection(backup, name, maximum, errors) {
  if (!Array.isArray(backup[name])) {
    errors.push(`${name}は配列である必要があります。`);
    return [];
  }
  if (backup[name].length > maximum) {
    errors.push(`${name}が上限${maximum}件を超えています。`);
  }
  return backup[name];
}

function validateTag(tag, index, ids, normalizedNames, errors) {
  const prefix = `tags[${index}]`;
  if (!tag || typeof tag !== 'object' || Array.isArray(tag)) {
    errors.push(`${prefix}はオブジェクトである必要があります。`);
    return;
  }
  if (!RECORD_ID_PATTERN.test(tag.id || '')) {
    errors.push(`${prefix}.idの形式が正しくありません。`);
  } else if (ids.has(tag.id)) {
    errors.push(`${prefix}.idが重複しています。`);
  } else {
    ids.add(tag.id);
  }
  if (tag.schemaVersion !== 1) {
    errors.push(`${prefix}.schemaVersionは1である必要があります。`);
  }
  if (typeof tag.name !== 'string' || tag.name.length < 1 || tag.name.length > 100) {
    errors.push(`${prefix}.nameは1文字以上100文字以内である必要があります。`);
  }
  if (
    typeof tag.normalizedName !== 'string' ||
    tag.normalizedName.length < 1 ||
    tag.normalizedName.length > 100
  ) {
    errors.push(`${prefix}.normalizedNameが正しくありません。`);
  } else if (tag.deletedAt === null && normalizedNames.has(tag.normalizedName)) {
    errors.push(`${prefix}.normalizedNameが有効な別タグと重複しています。`);
  } else if (tag.deletedAt === null) {
    normalizedNames.add(tag.normalizedName);
  }
  if (!isValidUtc(tag.createdAt) || !isValidUtc(tag.updatedAt)) {
    errors.push(`${prefix}の作成日時または更新日時が正しくありません。`);
  } else if (Date.parse(tag.updatedAt) < Date.parse(tag.createdAt)) {
    errors.push(`${prefix}.updatedAtがcreatedAtより前です。`);
  }
  if (tag.deletedAt !== null && !isValidUtc(tag.deletedAt)) {
    errors.push(`${prefix}.deletedAtが正しくありません。`);
  }
}

function validateRevision(revision, index, recordIds, errors) {
  const prefix = `revisions[${index}]`;
  if (!revision || typeof revision !== 'object' || Array.isArray(revision)) {
    errors.push(`${prefix}はオブジェクトである必要があります。`);
    return;
  }
  if (!RECORD_ID_PATTERN.test(revision.recordId || '') || !recordIds.has(revision.recordId)) {
    errors.push(`${prefix}.recordIdが存在する記録を参照していません。`);
  }
  if (!isValidUtc(revision.savedAt) || !isValidUtc(revision.expiresAt)) {
    errors.push(`${prefix}の保存日時または期限が正しくありません。`);
  }
  if (!revision.snapshot || typeof revision.snapshot !== 'object') {
    errors.push(`${prefix}.snapshotが正しくありません。`);
  }
}

function validateTombstone(tombstone, index, keys, errors) {
  const prefix = `tombstones[${index}]`;
  if (!tombstone || typeof tombstone !== 'object' || Array.isArray(tombstone)) {
    errors.push(`${prefix}はオブジェクトである必要があります。`);
    return;
  }
  if (!['record', 'tag'].includes(tombstone.entityType)) {
    errors.push(`${prefix}.entityTypeが正しくありません。`);
  }
  if (!RECORD_ID_PATTERN.test(tombstone.entityId || '')) {
    errors.push(`${prefix}.entityIdの形式が正しくありません。`);
  }
  const key = `${tombstone.entityType}:${tombstone.entityId}`;
  if (keys.has(key)) {
    errors.push(`${prefix}が重複しています。`);
  } else {
    keys.add(key);
  }
  if (!isValidUtc(tombstone.deletedAt)) {
    errors.push(`${prefix}.deletedAtが正しくありません。`);
  }
}

export function createBackupEnvelope(data, options = {}) {
  const exportedAt = options.exportedAt || new Date().toISOString();
  return {
    format: BACKUP_FORMAT,
    schemaVersion: BACKUP_SCHEMA_VERSION,
    appVersion: options.appVersion || null,
    producer: {
      name: options.producerName || 'kokolog',
      version: options.appVersion || 'development',
    },
    exportedAt,
    scope: options.scope || {
      type: 'all',
      fromLocal: null,
      toLocal: null,
    },
    source: options.source || {
      kind: 'app',
    },
    records: data.records || [],
    tags: data.tags || [],
    revisions: data.revisions || [],
    tombstones: data.tombstones || [],
    settings: {
      theme: data.settings?.theme || 'system',
    },
  };
}

export async function validateBackupEnvelope(backup) {
  const errors = [];
  const warnings = [];
  if (!backup || typeof backup !== 'object' || Array.isArray(backup)) {
    return { valid: false, errors: ['バックアップのルートが正しくありません。'], warnings };
  }
  if (backup.format !== BACKUP_FORMAT) {
    errors.push('ここログのバックアップ形式ではありません。');
  }
  if (backup.schemaVersion !== BACKUP_SCHEMA_VERSION) {
    errors.push('未対応のバックアップスキーマです。');
  }
  if (!isValidUtc(backup.exportedAt)) {
    errors.push('exportedAtが正しくありません。');
  } else if (Date.parse(backup.exportedAt) > Date.now() + 24 * 60 * 60 * 1000) {
    errors.push('exportedAtが将来すぎます。');
  }
  if (!backup.producer || typeof backup.producer.name !== 'string') {
    errors.push('producer.nameが必要です。');
  }
  if (!backup.source || typeof backup.source.kind !== 'string') {
    errors.push('source.kindが必要です。');
  }
  if (
    !backup.scope ||
    !['all', 'period'].includes(backup.scope.type) ||
    (backup.scope.type === 'period' &&
      (!backup.scope.fromLocal || !backup.scope.toLocal))
  ) {
    errors.push('scopeが正しくありません。');
  }

  const records = validateCollection(
    backup,
    'records',
    MAX_BACKUP_RECORDS,
    errors,
  );
  const tags = validateCollection(backup, 'tags', MAX_BACKUP_TAGS, errors);
  const revisions = validateCollection(
    backup,
    'revisions',
    MAX_BACKUP_REVISIONS,
    errors,
  );
  const tombstones = validateCollection(
    backup,
    'tombstones',
    MAX_BACKUP_TOMBSTONES,
    errors,
  );

  const recordIds = new Set();
  for (const [index, record] of records.entries()) {
    const validation = validatePersistedRecord(record);
    if (!validation.valid) {
      errors.push(`records[${index}]: ${validation.errors.join(' / ')}`);
    }
    if (recordIds.has(record.id)) {
      errors.push(`records[${index}]: 記録IDが重複しています。`);
    } else {
      recordIds.add(record.id);
    }
    if (HASH_PATTERN.test(record.contentHash || '')) {
      const expectedHash = `sha256:${await sha256(canonicalRecordContent(record))}`;
      if (record.contentHash !== expectedHash) {
        errors.push(`records[${index}]: 内容ハッシュが一致しません。`);
      }
      if (isValidUtc(record.updatedAt) && isValidUtc(backup.exportedAt)) {
        if (Date.parse(record.updatedAt) > Date.parse(backup.exportedAt)) {
          errors.push(`records[${index}]: 更新日時がエクスポート日時より後です。`);
        }
      }
    }
  }

  const tagIds = new Set();
  const normalizedTagNames = new Set();
  tags.forEach((tag, index) =>
    validateTag(tag, index, tagIds, normalizedTagNames, errors),
  );
  tags.forEach((tag, index) => {
    if (
      isValidUtc(tag.updatedAt) &&
      isValidUtc(backup.exportedAt) &&
      Date.parse(tag.updatedAt) > Date.parse(backup.exportedAt)
    ) {
      errors.push(`tags[${index}]: 更新日時がエクスポート日時より後です。`);
    }
  });
  records.forEach((record, recordIndex) => {
    for (const tagId of record.tagIds || []) {
      if (!tagIds.has(tagId)) {
        errors.push(`records[${recordIndex}]: 存在しないタグ${tagId}を参照しています。`);
      }
    }
  });

  revisions.forEach((revision, index) =>
    validateRevision(revision, index, recordIds, errors),
  );
  const tombstoneKeys = new Set();
  tombstones.forEach((tombstone, index) =>
    validateTombstone(tombstone, index, tombstoneKeys, errors),
  );

  if (!backup.settings || typeof backup.settings !== 'object') {
    errors.push('settingsが正しくありません。');
  } else if (
    backup.settings.theme !== undefined &&
    !['system', 'light', 'dark'].includes(backup.settings.theme)
  ) {
    errors.push('settings.themeが正しくありません。');
  }
  if (records.length === 0) {
    warnings.push('バックアップに記録がありません。');
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    summary: {
      records: records.length,
      tags: tags.length,
      revisions: revisions.length,
      tombstones: tombstones.length,
    },
  };
}

export function serializeBackup(backup) {
  return `${JSON.stringify(backup, null, 2)}\n`;
}

export function createBackupFileName(exportedAt = new Date().toISOString()) {
  const date = new Date(exportedAt);
  if (Number.isNaN(date.getTime())) {
    throw new TypeError('バックアップ日時が正しくありません。');
  }
  const stamp = date
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}Z$/, 'Z')
    .replace('T', '-');
  return `kokolog-backup-${stamp}.json`;
}
