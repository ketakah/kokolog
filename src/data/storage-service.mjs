import {
  STORES,
  requestToPromise,
  transactionToPromise,
} from './database.mjs';

const COUNTED_STORES = Object.freeze([
  STORES.records,
  STORES.tags,
  STORES.revisions,
  STORES.tombstones,
  STORES.drafts,
  STORES.snapshots,
  STORES.searchMeta,
]);

export async function getStorageCounts(database) {
  const transaction = database.transaction(COUNTED_STORES, 'readonly');
  const completion = transactionToPromise(transaction);
  const entries = await Promise.all(
    COUNTED_STORES.map(async (storeName) => [
      storeName,
      await requestToPromise(transaction.objectStore(storeName).count()),
    ]),
  );
  await completion;
  return Object.fromEntries(entries);
}

export async function getBrowserStorageInfo(environment = globalThis) {
  const storage = environment.navigator?.storage;
  let estimate = null;
  if (typeof storage?.estimate === 'function') {
    estimate = await storage.estimate();
  }
  let persistent = null;
  if (typeof storage?.persisted === 'function') {
    persistent = await storage.persisted();
  }

  const registration =
    typeof environment.navigator?.serviceWorker?.getRegistration === 'function'
      ? await environment.navigator.serviceWorker.getRegistration('./')
      : null;
  const cacheNames =
    typeof environment.caches?.keys === 'function'
      ? (await environment.caches.keys()).filter((name) =>
          name.startsWith('kokolog-'),
        )
      : [];

  return {
    estimateSupported: Boolean(estimate),
    usage: estimate?.usage ?? null,
    quota: estimate?.quota ?? null,
    persistenceSupported: typeof storage?.persist === 'function',
    persistent,
    serviceWorkerActive: registration?.active?.state === 'activated',
    serviceWorkerWaiting: Boolean(registration?.waiting),
    cacheNames,
  };
}

export async function requestPersistentStorage(environment = globalThis) {
  const persist = environment.navigator?.storage?.persist;
  if (typeof persist !== 'function') {
    return {
      supported: false,
      persistent: false,
    };
  }
  return {
    supported: true,
    persistent: await persist.call(environment.navigator.storage),
  };
}
