import {
  STORES,
  requestToPromise,
  transactionToPromise,
} from './database.mjs';
import {
  addContentHash,
  createRecord,
  updateRecord,
  validatePersistedRecord,
} from '../domain/record.mjs';
import {
  getMonthRange,
  getYearRange,
} from '../domain/calendar.mjs';
import { rememberRecordCount } from './safety-guard.mjs';
import { incrementChangeCountInTransaction } from './settings-repository.mjs';

const REVISION_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_REVISIONS_PER_RECORD = 10;

function revisionSnapshot(record) {
  return {
    title: record.title,
    body: record.body,
    mood: record.mood,
    tagIds: [...record.tagIds],
    favorite: record.favorite,
    occurredAtLocal: record.occurredAtLocal,
    occurredUtcOffsetMinutes: record.occurredUtcOffsetMinutes,
  };
}

function createRevision(record, savedAt) {
  return {
    id: `${record.id}_revision_${record.revision}`,
    recordId: record.id,
    revision: record.revision,
    savedAt,
    expiresAt: new Date(
      Date.parse(savedAt) + REVISION_RETENTION_MS,
    ).toISOString(),
    snapshot: revisionSnapshot(record),
  };
}

export class RecordsRepository {
  constructor(database) {
    this.database = database;
  }

  async listActive(options = {}) {
    const direction = options.direction === 'asc' ? 'next' : 'prev';
    const transaction = this.database.transaction(STORES.records, 'readonly');
    const index = transaction.objectStore(STORES.records).index('byOccurredAtLocal');
    const records = [];

    await new Promise((resolve, reject) => {
      const request = index.openCursor(null, direction);
      request.addEventListener('error', () => reject(request.error), { once: true });
      request.addEventListener('success', () => {
        const cursor = request.result;
        if (!cursor) {
          resolve();
          return;
        }
        if (cursor.value.deletedAt === null) {
          records.push(cursor.value);
        }
        cursor.continue();
      });
    });

    return records;
  }

  async listByRange(startInclusive, endExclusive, options = {}) {
    const direction = options.direction === 'desc' ? 'prev' : 'next';
    const transaction = this.database.transaction(STORES.records, 'readonly');
    const index = transaction.objectStore(STORES.records).index('byOccurredAtLocal');
    const range = IDBKeyRange.bound(startInclusive, endExclusive, false, true);
    const records = [];

    await new Promise((resolve, reject) => {
      const request = index.openCursor(range, direction);
      request.addEventListener(
        'error',
        () => reject(request.error || new Error('指定期間の記録を読み込めませんでした。')),
        { once: true },
      );
      request.addEventListener('success', () => {
        const cursor = request.result;
        if (!cursor) {
          resolve();
          return;
        }
        if (cursor.value.deletedAt === null) {
          records.push(cursor.value);
        }
        cursor.continue();
      });
    });
    return records;
  }

  async listByMonth(yearMonth, options = {}) {
    const range = getMonthRange(yearMonth);
    return this.listByRange(range.start, range.end, options);
  }

  async listByYear(year, options = {}) {
    const range = getYearRange(year);
    return this.listByRange(range.start, range.end, options);
  }

  async listByDay(dateKey, options = {}) {
    const start = `${dateKey}T00:00:00`;
    const endDate = new Date(`${dateKey}T00:00:00Z`);
    endDate.setUTCDate(endDate.getUTCDate() + 1);
    const end = endDate.toISOString().slice(0, 19);
    return this.listByRange(start, end, options);
  }

  async get(id) {
    const transaction = this.database.transaction(STORES.records, 'readonly');
    return requestToPromise(transaction.objectStore(STORES.records).get(id));
  }

  async countAll() {
    const transaction = this.database.transaction(STORES.records, 'readonly');
    return requestToPromise(transaction.objectStore(STORES.records).count());
  }

  async countActive() {
    return (await this.listActive()).length;
  }

  async put(record) {
    const validation = validatePersistedRecord(record);
    if (!validation.valid) {
      throw new Error(`保存する記録が正しくありません: ${validation.errors.join(' / ')}`);
    }

    const transaction = this.database.transaction(
      [STORES.records, STORES.settings],
      'readwrite',
    );
    transaction.objectStore(STORES.records).put(record);
    await incrementChangeCountInTransaction(
      transaction.objectStore(STORES.settings),
    );
    await transactionToPromise(transaction);
    rememberRecordCount(await this.countAll());
    return record;
  }

  async create(input, options = {}) {
    const record = await createRecord(input, options);
    return this.put(record);
  }

  async update(id, changes, options = {}) {
    const existing = await this.get(id);
    if (!existing || existing.deletedAt !== null) {
      throw new Error('更新対象の記録が見つかりません。');
    }
    const record = await updateRecord(existing, changes, options);
    if (record.contentHash === existing.contentHash) {
      return existing;
    }
    return this.putWithRevision(existing, record);
  }

  async toggleFavorite(id, options = {}) {
    const existing = await this.get(id);
    if (!existing || existing.deletedAt !== null) {
      throw new Error('お気に入りを変更する記録が見つかりません。');
    }
    const record = await updateRecord(
      existing,
      { favorite: !existing.favorite },
      options,
    );
    return this.put(record);
  }

  async putWithRevision(existing, record) {
    const validation = validatePersistedRecord(record);
    if (!validation.valid) {
      throw new Error(`保存する記録が正しくありません: ${validation.errors.join(' / ')}`);
    }
    const transaction = this.database.transaction(
      [STORES.records, STORES.revisions, STORES.settings],
      'readwrite',
    );
    const revisionsStore = transaction.objectStore(STORES.revisions);
    const currentRevisions = await requestToPromise(
      revisionsStore.index('byRecordId').getAll(existing.id),
    );
    const revision = createRevision(existing, record.updatedAt);
    const allRevisions = [...currentRevisions, revision].sort((left, right) =>
      right.savedAt.localeCompare(left.savedAt),
    );
    const now = Date.now();
    const keepIds = new Set(
      allRevisions
        .filter((item) => Date.parse(item.expiresAt) > now)
        .slice(0, MAX_REVISIONS_PER_RECORD)
        .map((item) => item.id),
    );

    transaction.objectStore(STORES.records).put(record);
    revisionsStore.put(revision);
    for (const oldRevision of allRevisions) {
      if (!keepIds.has(oldRevision.id)) {
        revisionsStore.delete(oldRevision.id);
      }
    }
    await incrementChangeCountInTransaction(
      transaction.objectStore(STORES.settings),
    );
    await transactionToPromise(transaction);
    rememberRecordCount(await this.countAll());
    return record;
  }

  async listRevisions(recordId) {
    const transaction = this.database.transaction(STORES.revisions, 'readonly');
    const revisions = await requestToPromise(
      transaction.objectStore(STORES.revisions).index('byRecordId').getAll(recordId),
    );
    return revisions
      .filter((revision) => Date.parse(revision.expiresAt) > Date.now())
      .sort((left, right) => right.savedAt.localeCompare(left.savedAt));
  }

  async restoreRevision(revisionId, options = {}) {
    const transaction = this.database.transaction(STORES.revisions, 'readonly');
    const revision = await requestToPromise(
      transaction.objectStore(STORES.revisions).get(revisionId),
    );
    if (!revision || Date.parse(revision.expiresAt) <= Date.now()) {
      throw new Error('復元する編集履歴が見つからないか、期限が切れています。');
    }
    return this.update(revision.recordId, revision.snapshot, options);
  }

  async cleanupExpiredRevisions(now = new Date()) {
    const transaction = this.database.transaction(STORES.revisions, 'readwrite');
    const request = transaction
      .objectStore(STORES.revisions)
      .index('byExpiresAt')
      .openCursor(IDBKeyRange.upperBound(now.toISOString()));
    let deleted = 0;
    await new Promise((resolve, reject) => {
      request.addEventListener(
        'error',
        () => reject(request.error || new Error('期限切れ履歴を削除できませんでした。')),
        { once: true },
      );
      request.addEventListener('success', () => {
        const cursor = request.result;
        if (!cursor) {
          resolve();
          return;
        }
        cursor.delete();
        deleted += 1;
        cursor.continue();
      });
    });
    await transactionToPromise(transaction);
    return deleted;
  }

  async listTrash() {
    const transaction = this.database.transaction(STORES.records, 'readonly');
    const index = transaction.objectStore(STORES.records).index('byDeletedAt');
    const records = [];
    await new Promise((resolve, reject) => {
      const request = index.openCursor(null, 'prev');
      request.addEventListener(
        'error',
        () => reject(request.error || new Error('ゴミ箱を読み込めませんでした。')),
        { once: true },
      );
      request.addEventListener('success', () => {
        const cursor = request.result;
        if (!cursor) {
          resolve();
          return;
        }
        if (cursor.value.deletedAt !== null) {
          records.push(cursor.value);
        }
        cursor.continue();
      });
    });
    return records;
  }

  async moveToTrash(id, options = {}) {
    const existing = await this.get(id);
    if (!existing || existing.deletedAt !== null) {
      throw new Error('ゴミ箱へ移動する記録が見つかりません。');
    }
    const now = options.now || new Date();
    const timestamp = now.toISOString();
    const deleted = await addContentHash({
      ...existing,
      deletedAt: timestamp,
      updatedAt: timestamp,
      revision: existing.revision + 1,
    });
    return this.put(deleted);
  }

  async restoreFromTrash(id, options = {}) {
    const existing = await this.get(id);
    if (!existing || existing.deletedAt === null) {
      throw new Error('復元する記録がゴミ箱に見つかりません。');
    }
    const timestamp = (options.now || new Date()).toISOString();
    const restored = await addContentHash({
      ...existing,
      deletedAt: null,
      updatedAt: timestamp,
      revision: existing.revision + 1,
    });
    return this.put(restored);
  }

  async permanentlyDelete(id, options = {}) {
    const existing = await this.get(id);
    if (!existing) {
      throw new Error('完全削除する記録が見つかりません。');
    }
    const deletedAt = (options.now || new Date()).toISOString();
    const transaction = this.database.transaction(
      [STORES.records, STORES.revisions, STORES.tombstones, STORES.settings],
      'readwrite',
    );
    const revisionsStore = transaction.objectStore(STORES.revisions);
    const revisionKeys = await requestToPromise(
      revisionsStore.index('byRecordId').getAllKeys(id),
    );
    transaction.objectStore(STORES.records).delete(id);
    revisionKeys.forEach((key) => revisionsStore.delete(key));
    transaction.objectStore(STORES.tombstones).put({
      entityType: 'record',
      entityId: id,
      deletedAt,
      source: existing.source || {
        kind: 'native',
        externalId: null,
      },
    });
    await incrementChangeCountInTransaction(
      transaction.objectStore(STORES.settings),
    );
    await transactionToPromise(transaction);
    rememberRecordCount(await this.countAll());
    return { id, deletedAt };
  }

  async purgeExpiredTrash(now = new Date()) {
    const cutoff = new Date(
      now.getTime() - REVISION_RETENTION_MS,
    ).toISOString();
    const trash = await this.listTrash();
    const expired = trash.filter(
      (record) => record.deletedAt && record.deletedAt <= cutoff,
    );
    if (expired.length === 0) {
      return 0;
    }
    await this.permanentlyDeleteMany(expired, now);
    return expired.length;
  }

  async emptyTrash(options = {}) {
    const trash = await this.listTrash();
    if (trash.length === 0) {
      return 0;
    }
    await this.permanentlyDeleteMany(trash, options.now || new Date());
    return trash.length;
  }

  async permanentlyDeleteMany(records, now) {
    const deletedAt = now.toISOString();
    const transaction = this.database.transaction(
      [STORES.records, STORES.revisions, STORES.tombstones, STORES.settings],
      'readwrite',
    );
    const recordsStore = transaction.objectStore(STORES.records);
    const revisionsStore = transaction.objectStore(STORES.revisions);
    const tombstonesStore = transaction.objectStore(STORES.tombstones);
    for (const record of records) {
      const revisionKeys = await requestToPromise(
        revisionsStore.index('byRecordId').getAllKeys(record.id),
      );
      recordsStore.delete(record.id);
      revisionKeys.forEach((key) => revisionsStore.delete(key));
      tombstonesStore.put({
        entityType: 'record',
        entityId: record.id,
        deletedAt,
        source: record.source || {
          kind: 'native',
          externalId: null,
        },
      });
    }
    await incrementChangeCountInTransaction(
      transaction.objectStore(STORES.settings),
      records.length,
    );
    await transactionToPromise(transaction);
    rememberRecordCount(await this.countAll());
  }
}
