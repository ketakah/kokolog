import {
  STORES,
  requestToPromise,
  transactionToPromise,
} from './database.mjs';

export class DraftsRepository {
  constructor(database) {
    this.database = database;
  }

  async get(id) {
    const transaction = this.database.transaction(STORES.drafts, 'readonly');
    return requestToPromise(transaction.objectStore(STORES.drafts).get(id));
  }

  async save(draft) {
    if (!draft?.id || !draft?.fields || !draft?.savedAt) {
      throw new Error('下書きデータが正しくありません。');
    }
    const transaction = this.database.transaction(STORES.drafts, 'readwrite');
    transaction.objectStore(STORES.drafts).put(draft);
    await transactionToPromise(transaction);
    return draft;
  }

  async delete(id) {
    const transaction = this.database.transaction(STORES.drafts, 'readwrite');
    transaction.objectStore(STORES.drafts).delete(id);
    await transactionToPromise(transaction);
  }
}
