import {
  DATABASE_NAME,
  closeDatabase,
  deleteDatabase,
} from './database.mjs';

export const KOKOLOG_STORAGE_PREFIX = 'kokolog:';
export const KOKOLOG_CACHE_PREFIX = 'kokolog-';

export function isKokologStorageKey(key) {
  return String(key).startsWith(KOKOLOG_STORAGE_PREFIX);
}

export function isKokologCacheName(name) {
  return String(name).startsWith(KOKOLOG_CACHE_PREFIX);
}

function removeKokologStorage(storage) {
  if (!storage) {
    return;
  }
  const keys = [];
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (key && isKokologStorageKey(key)) {
      keys.push(key);
    }
  }
  keys.forEach((key) => storage.removeItem(key));
}

async function verifyDatabaseDeleted(indexedDb) {
  if (typeof indexedDb?.databases !== 'function') {
    return;
  }
  const databases = await indexedDb.databases();
  if (databases.some((database) => database.name === DATABASE_NAME)) {
    throw new Error('IndexedDBの削除を確認できませんでした。');
  }
}

export async function deleteAllKokologData(environment = globalThis) {
  const registration =
    typeof environment.navigator?.serviceWorker?.getRegistration === 'function'
      ? await environment.navigator.serviceWorker.getRegistration('./')
      : null;
  if (registration && !(await registration.unregister())) {
    throw new Error('Service Workerの登録を解除できませんでした。');
  }

  if (typeof environment.caches?.keys === 'function') {
    const cacheNames = await environment.caches.keys();
    await Promise.all(
      cacheNames
        .filter(isKokologCacheName)
        .map((name) => environment.caches.delete(name)),
    );
    const remaining = (await environment.caches.keys()).filter(
      isKokologCacheName,
    );
    if (remaining.length > 0) {
      throw new Error('ここログのApp Shellキャッシュを削除できませんでした。');
    }
  }

  closeDatabase();
  await deleteDatabase();
  await verifyDatabaseDeleted(environment.indexedDB);

  removeKokologStorage(environment.localStorage);
  removeKokologStorage(environment.sessionStorage);
  const remainingKeys = [];
  for (const storage of [environment.localStorage, environment.sessionStorage]) {
    if (!storage) {
      continue;
    }
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);
      if (key && isKokologStorageKey(key)) {
        remainingKeys.push(key);
      }
    }
  }
  if (remainingKeys.length > 0) {
    throw new Error('ここログのブラウザー設定を削除できませんでした。');
  }

  return {
    databaseDeleted: true,
    cacheDeleted: true,
    storageDeleted: true,
    serviceWorkerUnregistered: true,
  };
}
