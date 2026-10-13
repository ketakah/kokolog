export const DATABASE_NAME = 'kokolog-db';
export const DATABASE_VERSION = 1;

export const STORES = Object.freeze({
  records: 'records',
  tags: 'tags',
  revisions: 'revisions',
  tombstones: 'tombstones',
  drafts: 'drafts',
  settings: 'settings',
  snapshots: 'snapshots',
  searchMeta: 'searchMeta',
});

let activeDatabase = null;

export function requestToPromise(request) {
  return new Promise((resolve, reject) => {
    request.addEventListener('success', () => resolve(request.result), { once: true });
    request.addEventListener(
      'error',
      () => reject(request.error || new Error('IndexedDBリクエストに失敗しました。')),
      { once: true },
    );
  });
}

export function transactionToPromise(transaction) {
  return new Promise((resolve, reject) => {
    transaction.addEventListener('complete', () => resolve(), { once: true });
    transaction.addEventListener(
      'abort',
      () => reject(transaction.error || new Error('IndexedDBトランザクションが中断されました。')),
      { once: true },
    );
    transaction.addEventListener(
      'error',
      () => reject(transaction.error || new Error('IndexedDBトランザクションに失敗しました。')),
      { once: true },
    );
  });
}

function createIndexIfMissing(store, name, keyPath, options) {
  if (!store.indexNames.contains(name)) {
    store.createIndex(name, keyPath, options);
  }
}

function upgradeToVersion1(database) {
  const records = database.createObjectStore(STORES.records, { keyPath: 'id' });
  createIndexIfMissing(records, 'byOccurredAtLocal', 'occurredAtLocal');
  createIndexIfMissing(records, 'byUpdatedAt', 'updatedAt');
  createIndexIfMissing(records, 'byDeletedAt', 'deletedAt');
  createIndexIfMissing(records, 'byFavorite', 'favorite');
  createIndexIfMissing(records, 'byMood', 'mood');

  const tags = database.createObjectStore(STORES.tags, { keyPath: 'id' });
  createIndexIfMissing(tags, 'byNormalizedName', 'normalizedName', { unique: true });
  createIndexIfMissing(tags, 'byDeletedAt', 'deletedAt');

  const revisions = database.createObjectStore(STORES.revisions, { keyPath: 'id' });
  createIndexIfMissing(revisions, 'byRecordId', 'recordId');
  createIndexIfMissing(revisions, 'byExpiresAt', 'expiresAt');

  const tombstones = database.createObjectStore(STORES.tombstones, {
    keyPath: ['entityType', 'entityId'],
  });
  createIndexIfMissing(tombstones, 'byDeletedAt', 'deletedAt');

  const drafts = database.createObjectStore(STORES.drafts, { keyPath: 'id' });
  createIndexIfMissing(drafts, 'byRecordId', 'recordId');
  createIndexIfMissing(drafts, 'bySavedAt', 'savedAt');

  database.createObjectStore(STORES.settings, { keyPath: 'key' });

  const snapshots = database.createObjectStore(STORES.snapshots, { keyPath: 'id' });
  createIndexIfMissing(snapshots, 'byExpiresAt', 'expiresAt');

  database.createObjectStore(STORES.searchMeta, { keyPath: 'key' });
}

export function openDatabase() {
  if (!globalThis.indexedDB) {
    return Promise.reject(new Error('このブラウザではIndexedDBを利用できません。'));
  }
  if (activeDatabase) {
    return Promise.resolve(activeDatabase);
  }

  return new Promise((resolve, reject) => {
    const request = globalThis.indexedDB.open(DATABASE_NAME, DATABASE_VERSION);

    request.addEventListener('upgradeneeded', (event) => {
      const database = request.result;
      if (event.oldVersion === 0) {
        upgradeToVersion1(database);
      }
    });
    request.addEventListener(
      'blocked',
      () => reject(new Error('別のここログがデータベース更新を妨げています。すべての画面を閉じて再試行してください。')),
      { once: true },
    );
    request.addEventListener(
      'error',
      () => reject(request.error || new Error('IndexedDBを開けませんでした。')),
      { once: true },
    );
    request.addEventListener(
      'success',
      () => {
        const database = request.result;
        database.addEventListener('versionchange', () => {
          database.close();
          if (activeDatabase === database) {
            activeDatabase = null;
          }
        });
        activeDatabase = database;
        resolve(database);
      },
      { once: true },
    );
  });
}

export function closeDatabase() {
  if (activeDatabase) {
    activeDatabase.close();
    activeDatabase = null;
  }
}

export function countStoreRecords(database, storeName) {
  const transaction = database.transaction(storeName, 'readonly');
  const request = transaction.objectStore(storeName).count();
  return requestToPromise(request);
}

export function deleteDatabase() {
  closeDatabase();
  return new Promise((resolve, reject) => {
    const request = globalThis.indexedDB.deleteDatabase(DATABASE_NAME);
    request.addEventListener('success', () => resolve(), { once: true });
    request.addEventListener(
      'blocked',
      () => reject(new Error('データベースが使用中のため削除できません。')),
      { once: true },
    );
    request.addEventListener(
      'error',
      () => reject(request.error || new Error('データベースを削除できませんでした。')),
      { once: true },
    );
  });
}
