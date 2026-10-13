import {
  STORES,
  requestToPromise,
  transactionToPromise,
} from './database.mjs';

export const SETTING_KEYS = Object.freeze({
  theme: 'theme',
  changeCount: 'changeCount',
  mutationGeneration: 'mutationGeneration',
  lastFullBackupAt: 'lastFullBackupAt',
  lastFullBackupChangeCount: 'lastFullBackupChangeCount',
  lastSuccessfulStartAt: 'lastSuccessfulStartAt',
});

export async function incrementChangeCountInTransaction(settingsStore, amount = 1) {
  const [current, generation] = await Promise.all([
    requestToPromise(settingsStore.get(SETTING_KEYS.changeCount)),
    requestToPromise(settingsStore.get(SETTING_KEYS.mutationGeneration)),
  ]);
  const nextValue = Math.max(0, Number(current?.value || 0)) + amount;
  const nextGeneration = Math.max(0, Number(generation?.value || 0)) + 1;
  const updatedAt = new Date().toISOString();
  settingsStore.put({
    key: SETTING_KEYS.changeCount,
    value: nextValue,
    updatedAt,
  });
  settingsStore.put({
    key: SETTING_KEYS.mutationGeneration,
    value: nextGeneration,
    updatedAt,
  });
  return {
    changeCount: nextValue,
    mutationGeneration: nextGeneration,
  };
}

export class SettingsRepository {
  constructor(database) {
    this.database = database;
  }

  async get(key, fallback = null) {
    const transaction = this.database.transaction(STORES.settings, 'readonly');
    const result = await requestToPromise(transaction.objectStore(STORES.settings).get(key));
    return result ? result.value : fallback;
  }

  async set(key, value, options = {}) {
    const transaction = this.database.transaction(STORES.settings, 'readwrite');
    transaction.objectStore(STORES.settings).put({
      key,
      value,
      updatedAt: (options.now || new Date()).toISOString(),
    });
    await transactionToPromise(transaction);
    return value;
  }

  async getChangeCount() {
    return Number(await this.get(SETTING_KEYS.changeCount, 0)) || 0;
  }

  async getMutationGeneration() {
    return Number(await this.get(SETTING_KEYS.mutationGeneration, 0)) || 0;
  }

  async markFullBackup(exportedAt) {
    const changeCount = await this.getChangeCount();
    const transaction = this.database.transaction(STORES.settings, 'readwrite');
    const store = transaction.objectStore(STORES.settings);
    const updatedAt = new Date().toISOString();
    store.put({
      key: SETTING_KEYS.lastFullBackupAt,
      value: exportedAt,
      updatedAt,
    });
    store.put({
      key: SETTING_KEYS.lastFullBackupChangeCount,
      value: changeCount,
      updatedAt,
    });
    await transactionToPromise(transaction);
  }

  async getBackupStatus(now = new Date()) {
    const transaction = this.database.transaction(STORES.settings, 'readonly');
    const store = transaction.objectStore(STORES.settings);
    const [lastBackup, backupChangeCount, changeCount] = await Promise.all([
      requestToPromise(store.get(SETTING_KEYS.lastFullBackupAt)),
      requestToPromise(store.get(SETTING_KEYS.lastFullBackupChangeCount)),
      requestToPromise(store.get(SETTING_KEYS.changeCount)),
    ]);
    const lastFullBackupAt = lastBackup?.value || null;
    const currentChangeCount = Number(changeCount?.value || 0);
    const changesSinceBackup = Math.max(
      0,
      currentChangeCount - Number(backupChangeCount?.value || 0),
    );
    const daysSinceBackup = lastFullBackupAt
      ? Math.floor((now.getTime() - Date.parse(lastFullBackupAt)) / 86400000)
      : null;

    return {
      lastFullBackupAt,
      currentChangeCount,
      changesSinceBackup,
      daysSinceBackup,
      reminderNeeded:
        !lastFullBackupAt || daysSinceBackup >= 30 || changesSinceBackup >= 50,
    };
  }

  async markSuccessfulStart(now = new Date()) {
    return this.set(SETTING_KEYS.lastSuccessfulStartAt, now.toISOString(), {
      now,
    });
  }

  async getLastSuccessfulStart() {
    return this.get(SETTING_KEYS.lastSuccessfulStartAt, null);
  }

  async getExportableSettings() {
    return {
      theme: await this.get(SETTING_KEYS.theme, 'system'),
    };
  }
}
