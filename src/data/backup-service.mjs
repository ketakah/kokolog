import {
  MAX_BACKUP_BYTES,
  createBackupEnvelope,
  serializeBackup,
  validateBackupEnvelope,
} from '../domain/backup.mjs';
import {
  addContentHash,
  canonicalRecordContent,
} from '../domain/record.mjs';
import {
  STORES,
  requestToPromise,
  transactionToPromise,
} from './database.mjs';
import { rememberRecordCount } from './safety-guard.mjs';
import {
  SETTING_KEYS,
  incrementChangeCountInTransaction,
} from './settings-repository.mjs';

const SNAPSHOT_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

function clone(value) {
  if (typeof globalThis.structuredClone === 'function') {
    return globalThis.structuredClone(value);
  }
  return JSON.parse(JSON.stringify(value));
}

function tombstoneKey(tombstone) {
  return `${tombstone.entityType}:${tombstone.entityId}`;
}

function tagContent(tag) {
  return JSON.stringify({
    name: tag.name,
    normalizedName: tag.normalizedName,
    deletedAt: tag.deletedAt,
  });
}

function utcMilliseconds(value) {
  return Date.parse(value);
}

function isIncomingNewer(incoming, current) {
  return utcMilliseconds(incoming.updatedAt) > utcMilliseconds(current.updatedAt);
}

function isIncomingOlder(incoming, current) {
  return utcMilliseconds(incoming.updatedAt) < utcMilliseconds(current.updatedAt);
}

function isAtLeastAsNew(timestamp, otherTimestamp) {
  return utcMilliseconds(timestamp) >= utcMilliseconds(otherTimestamp);
}

export function shouldDeleteSelectedRecord(current, incoming, tombstone) {
  const selectedRecord =
    current && incoming
      ? utcMilliseconds(incoming.updatedAt) > utcMilliseconds(current.updatedAt)
        ? incoming
        : current
      : incoming || current;
  return Boolean(
    selectedRecord &&
      isAtLeastAsNew(tombstone.deletedAt, selectedRecord.updatedAt),
  );
}

export class StaleImportAnalysisError extends Error {
  constructor() {
    super('インポート確認後に別の画面またはタブでデータが変更されました。ファイルを選び直して再確認してください。');
    this.name = 'StaleImportAnalysisError';
    this.code = 'STALE_IMPORT_ANALYSIS';
  }
}

function snapshotId(now) {
  const suffix =
    typeof globalThis.crypto?.randomUUID === 'function'
      ? globalThis.crypto.randomUUID()
      : String(Math.random()).slice(2);
  return `pre-replace-${now.getTime()}-${suffix}`;
}

async function readStores(database, storeNames) {
  const transaction = database.transaction(storeNames, 'readonly');
  const requests = storeNames.map((name) =>
    requestToPromise(transaction.objectStore(name).getAll()),
  );
  const values = await Promise.all(requests);
  return Object.fromEntries(storeNames.map((name, index) => [name, values[index]]));
}

async function collectBackupState(database, options = {}) {
  const storeNames = [
    STORES.records,
    STORES.tags,
    STORES.revisions,
    STORES.tombstones,
    STORES.settings,
  ];
  const values = await readStores(database, storeNames);
  const settingsMap = new Map(
    values[STORES.settings].map((setting) => [setting.key, setting.value]),
  );
  const scope = options.scope || {
    type: 'all',
    fromLocal: null,
    toLocal: null,
  };

  const records =
    scope.type === 'period'
      ? values[STORES.records].filter(
          (record) =>
            record.occurredAtLocal >= scope.fromLocal &&
            record.occurredAtLocal <= scope.toLocal,
        )
      : values[STORES.records];
  const includedRecordIds = new Set(records.map((record) => record.id));
  const revisions =
    scope.type === 'period'
      ? values[STORES.revisions].filter((revision) =>
          includedRecordIds.has(revision.recordId),
        )
      : values[STORES.revisions];

  const backup = createBackupEnvelope(
    {
      records,
      tags: values[STORES.tags],
      revisions,
      tombstones: values[STORES.tombstones],
      settings: {
        theme: settingsMap.get(SETTING_KEYS.theme) || 'system',
      },
    },
    {
      appVersion: options.appVersion || '0.1.0',
      exportedAt: options.exportedAt,
      scope,
    },
  );
  return {
    backup,
    mutationGeneration: Number(
      settingsMap.get(SETTING_KEYS.mutationGeneration) || 0,
    ),
  };
}

export async function collectBackup(database, options = {}) {
  return (await collectBackupState(database, options)).backup;
}

export async function createSerializedBackup(database, options = {}) {
  const backup = await collectBackup(database, options);
  const validation = await validateBackupEnvelope(backup);
  if (!validation.valid) {
    throw new Error(`バックアップを生成後に検証できませんでした: ${validation.errors.join(' / ')}`);
  }
  return {
    backup,
    json: serializeBackup(backup),
    validation,
  };
}

export async function parseAndValidateBackupText(text, options = {}) {
  const byteLength =
    options.byteLength ?? new TextEncoder().encode(String(text || '')).byteLength;
  if (byteLength > MAX_BACKUP_BYTES) {
    throw new Error(`バックアップファイルの上限は${MAX_BACKUP_BYTES}バイトです。`);
  }

  let backup;
  try {
    backup = JSON.parse(String(text || '').replace(/^\uFEFF/, ''));
  } catch (error) {
    throw new Error(`JSONを解析できませんでした: ${error.message}`);
  }

  const validation = await validateBackupEnvelope(backup);
  if (!validation.valid) {
    throw new Error(`バックアップを検証できませんでした:\n${validation.errors.join('\n')}`);
  }
  return { backup, validation };
}

export async function cleanupExpiredSnapshots(database, now = new Date()) {
  const transaction = database.transaction(STORES.snapshots, 'readwrite');
  const index = transaction.objectStore(STORES.snapshots).index('byExpiresAt');
  const upperBound = IDBKeyRange.upperBound(now.toISOString());
  const request = index.openCursor(upperBound);

  await new Promise((resolve, reject) => {
    request.addEventListener('error', () => reject(request.error), { once: true });
    request.addEventListener('success', () => {
      const cursor = request.result;
      if (!cursor) {
        resolve();
        return;
      }
      cursor.delete();
      cursor.continue();
    });
  });
  await transactionToPromise(transaction);
}

export async function savePreReplaceSnapshot(database, backup, now = new Date()) {
  await cleanupExpiredSnapshots(database, now);
  const snapshot = {
    id: snapshotId(now),
    kind: 'pre-replace',
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + SNAPSHOT_RETENTION_MS).toISOString(),
    backup: clone(backup),
  };
  const transaction = database.transaction(STORES.snapshots, 'readwrite');
  transaction.objectStore(STORES.snapshots).put(snapshot);
  await transactionToPromise(transaction);
  return snapshot;
}

export async function listSnapshots(database, now = new Date()) {
  await cleanupExpiredSnapshots(database, now);
  const transaction = database.transaction(STORES.snapshots, 'readonly');
  const snapshots = await requestToPromise(
    transaction.objectStore(STORES.snapshots).getAll(),
  );
  return snapshots.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

async function deleteSnapshot(database, snapshotId) {
  if (!snapshotId) {
    return;
  }
  const transaction = database.transaction(STORES.snapshots, 'readwrite');
  transaction.objectStore(STORES.snapshots).delete(snapshotId);
  await transactionToPromise(transaction);
}

export async function analyzeImport(database, backup) {
  const validation = await validateBackupEnvelope(backup);
  if (!validation.valid) {
    throw new Error(`バックアップを検証できませんでした: ${validation.errors.join(' / ')}`);
  }

  const local = await readStores(database, [
    STORES.records,
    STORES.tags,
    STORES.tombstones,
    STORES.settings,
  ]);
  const currentRecords = new Map(
    local[STORES.records].map((record) => [record.id, record]),
  );
  const currentTags = new Map(local[STORES.tags].map((tag) => [tag.id, tag]));
  const currentActiveTagsByName = new Map(
    local[STORES.tags]
      .filter((tag) => tag.deletedAt === null)
      .map((tag) => [tag.normalizedName, tag]),
  );
  const currentTombstones = new Map(
    local[STORES.tombstones].map((tombstone) => [
      tombstoneKey(tombstone),
      tombstone,
    ]),
  );
  const localSettings = new Map(
    local[STORES.settings].map((setting) => [setting.key, setting.value]),
  );
  const baseMutationGeneration = Number(
    localSettings.get(SETTING_KEYS.mutationGeneration) || 0,
  );

  const tagIdRemap = new Map();
  const tagsToPut = [];
  let duplicateTags = 0;
  let keptCurrentTags = 0;

  for (const incomingTag of backup.tags) {
    const sameId = currentTags.get(incomingTag.id);
    const sameName =
      incomingTag.deletedAt === null
        ? currentActiveTagsByName.get(incomingTag.normalizedName)
        : null;

    if (sameName && sameName.id !== incomingTag.id) {
      tagIdRemap.set(incomingTag.id, sameName.id);
      duplicateTags += 1;
      continue;
    }
    if (!sameId) {
      tagsToPut.push(incomingTag);
      continue;
    }
    if (tagContent(sameId) === tagContent(incomingTag)) {
      duplicateTags += 1;
    } else if (isIncomingNewer(incomingTag, sameId)) {
      tagsToPut.push(incomingTag);
    } else {
      keptCurrentTags += 1;
    }
  }

  const incomingTombstonesByKey = new Map();
  const tombstonesToPut = [];
  for (const tombstone of backup.tombstones) {
    const key = tombstoneKey(tombstone);
    const current = currentTombstones.get(key);
    const selected =
      !current ||
      utcMilliseconds(tombstone.deletedAt) > utcMilliseconds(current.deletedAt)
        ? tombstone
        : current;
    incomingTombstonesByKey.set(key, selected);
    if (!current || selected === tombstone) {
      tombstonesToPut.push(tombstone);
    }
  }

  const newRecords = [];
  const updatedRecords = [];
  const duplicateRecords = [];
  const keptCurrentRecords = [];
  const blockedRecords = [];
  const conflicts = [];
  const normalizedIncomingRecordsById = new Map();

  for (const sourceRecord of backup.records) {
    const remappedTagIds = [...new Set(
      sourceRecord.tagIds.map((tagId) => tagIdRemap.get(tagId) || tagId),
    )].sort();
    const incomingRecord =
      remappedTagIds.join('\u0000') === sourceRecord.tagIds.join('\u0000')
        ? sourceRecord
        : await addContentHash({ ...sourceRecord, tagIds: remappedTagIds });
    normalizedIncomingRecordsById.set(incomingRecord.id, incomingRecord);
    const effectiveTombstone =
      incomingTombstonesByKey.get(`record:${incomingRecord.id}`) ||
      currentTombstones.get(`record:${incomingRecord.id}`);
    if (
      effectiveTombstone &&
      isAtLeastAsNew(effectiveTombstone.deletedAt, incomingRecord.updatedAt)
    ) {
      blockedRecords.push(incomingRecord);
      continue;
    }

    const current = currentRecords.get(incomingRecord.id);
    if (!current) {
      newRecords.push(incomingRecord);
      continue;
    }
    if (
      current.contentHash === incomingRecord.contentHash &&
      canonicalRecordContent(current) === canonicalRecordContent(incomingRecord)
    ) {
      duplicateRecords.push(incomingRecord);
    } else if (isIncomingNewer(incomingRecord, current)) {
      updatedRecords.push(incomingRecord);
    } else if (isIncomingOlder(incomingRecord, current)) {
      keptCurrentRecords.push(incomingRecord);
    } else {
      conflicts.push({
        id: incomingRecord.id,
        current,
        incoming: incomingRecord,
      });
    }
  }

  const recordIdsToDelete = [];
  for (const tombstone of tombstonesToPut) {
    if (tombstone.entityType !== 'record') {
      continue;
    }
    const current = currentRecords.get(tombstone.entityId);
    const incoming = normalizedIncomingRecordsById.get(tombstone.entityId);
    if (shouldDeleteSelectedRecord(current, incoming, tombstone)) {
      recordIdsToDelete.push(tombstone.entityId);
    }
  }

  return {
    backup,
    validation,
    newRecords,
    updatedRecords,
    duplicateRecords,
    keptCurrentRecords,
    blockedRecords,
    conflicts,
    tagsToPut,
    duplicateTags,
    keptCurrentTags,
    tombstonesToPut,
    recordIdsToDelete,
    revisionsToPut: backup.revisions,
    tagIdRemap: Object.fromEntries(tagIdRemap),
    baseMutationGeneration,
    summary: {
      newRecords: newRecords.length,
      updatedRecords: updatedRecords.length,
      duplicateRecords: duplicateRecords.length,
      keptCurrentRecords: keptCurrentRecords.length,
      blockedRecords: blockedRecords.length,
      conflicts: conflicts.length,
      tagsToPut: tagsToPut.length,
      duplicateTags,
      keptCurrentTags,
      tombstonesToPut: tombstonesToPut.length,
      recordIdsToDelete: recordIdsToDelete.length,
    },
  };
}

export async function applyMerge(database, analysis, conflictResolutions = {}) {
  const selectedConflictRecords = [];
  for (const conflict of analysis.conflicts) {
    const resolution = conflictResolutions[conflict.id];
    if (!['current', 'incoming'].includes(resolution)) {
      throw new Error(`記録${conflict.id}の競合解決方法を選んでください。`);
    }
    if (resolution === 'incoming') {
      selectedConflictRecords.push(conflict.incoming);
    }
  }

  let safetySnapshot = null;
  if (analysis.recordIdsToDelete.length > 0) {
    const currentState = await collectBackupState(database);
    if (currentState.mutationGeneration !== analysis.baseMutationGeneration) {
      throw new StaleImportAnalysisError();
    }
    safetySnapshot = await savePreReplaceSnapshot(
      database,
      currentState.backup,
    );
  }

  const stores = [
    STORES.records,
    STORES.tags,
    STORES.revisions,
    STORES.tombstones,
    STORES.settings,
  ];
  const transaction = database.transaction(stores, 'readwrite');
  const completion = transactionToPromise(transaction);
  const recordsStore = transaction.objectStore(STORES.records);
  const tagsStore = transaction.objectStore(STORES.tags);
  const revisionsStore = transaction.objectStore(STORES.revisions);
  const tombstonesStore = transaction.objectStore(STORES.tombstones);
  const settingsStore = transaction.objectStore(STORES.settings);
  const generationRecord = await requestToPromise(
    settingsStore.get(SETTING_KEYS.mutationGeneration),
  );
  const currentGeneration = Number(generationRecord?.value || 0);
  if (currentGeneration !== analysis.baseMutationGeneration) {
    transaction.abort();
    await completion.catch(() => {});
    await deleteSnapshot(database, safetySnapshot?.id);
    throw new StaleImportAnalysisError();
  }

  for (const record of [
    ...analysis.newRecords,
    ...analysis.updatedRecords,
    ...selectedConflictRecords,
  ]) {
    recordsStore.put(record);
  }
  for (const recordId of analysis.recordIdsToDelete) {
    recordsStore.delete(recordId);
  }
  for (const tag of analysis.tagsToPut) {
    tagsStore.put(tag);
  }
  for (const revision of analysis.revisionsToPut) {
    revisionsStore.put(revision);
  }
  for (const tombstone of analysis.tombstonesToPut) {
    tombstonesStore.put(tombstone);
  }

  const changeAmount =
    analysis.newRecords.length +
    analysis.updatedRecords.length +
    selectedConflictRecords.length +
    analysis.recordIdsToDelete.length +
    analysis.tagsToPut.length +
    analysis.tombstonesToPut.length;
  if (changeAmount > 0) {
    await incrementChangeCountInTransaction(
      settingsStore,
      changeAmount,
    );
  }
  try {
    await completion;
  } catch (error) {
    await deleteSnapshot(database, safetySnapshot?.id);
    throw error;
  }

  const countTransaction = database.transaction(STORES.records, 'readonly');
  const count = await requestToPromise(
    countTransaction.objectStore(STORES.records).count(),
  );
  rememberRecordCount(count);
  return {
    ...analysis.summary,
    conflictsUsingIncoming: selectedConflictRecords.length,
    conflictsKeepingCurrent:
      analysis.conflicts.length - selectedConflictRecords.length,
    safetySnapshot,
  };
}

export async function replaceWithBackup(database, backup, options = {}) {
  const validation = await validateBackupEnvelope(backup);
  if (!validation.valid) {
    throw new Error(`バックアップを検証できませんでした: ${validation.errors.join(' / ')}`);
  }

  const currentState = await collectBackupState(database, {
    appVersion: options.appVersion || '0.1.0',
  });
  const expectedMutationGeneration =
    options.expectedMutationGeneration ?? currentState.mutationGeneration;
  if (currentState.mutationGeneration !== expectedMutationGeneration) {
    throw new StaleImportAnalysisError();
  }

  let snapshot = null;
  if (options.createSnapshot !== false) {
    snapshot = await savePreReplaceSnapshot(
      database,
      currentState.backup,
      options.now || new Date(),
    );
  }

  const stores = [
    STORES.records,
    STORES.tags,
    STORES.revisions,
    STORES.tombstones,
    STORES.drafts,
    STORES.settings,
  ];
  const transaction = database.transaction(stores, 'readwrite');
  const completion = transactionToPromise(transaction);
  const recordsStore = transaction.objectStore(STORES.records);
  const tagsStore = transaction.objectStore(STORES.tags);
  const revisionsStore = transaction.objectStore(STORES.revisions);
  const tombstonesStore = transaction.objectStore(STORES.tombstones);
  const draftsStore = transaction.objectStore(STORES.drafts);
  const settingsStore = transaction.objectStore(STORES.settings);
  const generationRecord = await requestToPromise(
    settingsStore.get(SETTING_KEYS.mutationGeneration),
  );
  if (
    Number(generationRecord?.value || 0) !== expectedMutationGeneration
  ) {
    transaction.abort();
    await completion.catch(() => {});
    await deleteSnapshot(database, snapshot?.id);
    throw new StaleImportAnalysisError();
  }

  recordsStore.clear();
  tagsStore.clear();
  revisionsStore.clear();
  tombstonesStore.clear();
  draftsStore.clear();

  backup.records.forEach((record) => recordsStore.put(record));
  backup.tags.forEach((tag) => tagsStore.put(tag));
  backup.revisions.forEach((revision) => revisionsStore.put(revision));
  backup.tombstones.forEach((tombstone) => tombstonesStore.put(tombstone));
  if (backup.settings?.theme) {
    settingsStore.put({
      key: SETTING_KEYS.theme,
      value: backup.settings.theme,
      updatedAt: new Date().toISOString(),
    });
  }
  await incrementChangeCountInTransaction(
    settingsStore,
    Math.max(1, backup.records.length + backup.tags.length),
  );
  try {
    await completion;
  } catch (error) {
    await deleteSnapshot(database, snapshot?.id);
    throw error;
  }
  rememberRecordCount(backup.records.length);

  return {
    snapshot,
    records: backup.records.length,
    tags: backup.tags.length,
    revisions: backup.revisions.length,
    tombstones: backup.tombstones.length,
  };
}

export async function restoreSnapshot(database, snapshot, options = {}) {
  if (!snapshot?.backup || snapshot.expiresAt <= new Date().toISOString()) {
    throw new Error('このスナップショットは利用できません。');
  }
  return replaceWithBackup(database, snapshot.backup, {
    ...options,
    createSnapshot: true,
  });
}
