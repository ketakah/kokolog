import {
  STORES,
  requestToPromise,
  transactionToPromise,
} from './database.mjs';
import { incrementChangeCountInTransaction } from './settings-repository.mjs';

function randomTagId() {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return `tag_${globalThis.crypto.randomUUID()}`;
  }
  if (typeof globalThis.crypto?.getRandomValues !== 'function') {
    throw new Error('安全なタグIDを生成できません。');
  }
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  return `tag_${hex}`;
}

export function normalizeTagName(name) {
  return String(name || '').normalize('NFKC').trim().toLocaleLowerCase('ja-JP');
}

export class TagsRepository {
  constructor(database) {
    this.database = database;
  }

  async listActive() {
    const transaction = this.database.transaction(STORES.tags, 'readonly');
    const tags = await requestToPromise(transaction.objectStore(STORES.tags).getAll());
    return tags
      .filter((tag) => tag.deletedAt === null)
      .sort((left, right) => left.name.localeCompare(right.name, 'ja'));
  }

  async get(id) {
    const transaction = this.database.transaction(STORES.tags, 'readonly');
    return requestToPromise(transaction.objectStore(STORES.tags).get(id));
  }

  async findByNormalizedName(normalizedName) {
    const transaction = this.database.transaction(STORES.tags, 'readonly');
    const index = transaction.objectStore(STORES.tags).index('byNormalizedName');
    return requestToPromise(index.get(normalizedName));
  }

  async create(name, options = {}) {
    const trimmedName = String(name || '').trim();
    const normalizedName = normalizeTagName(trimmedName);
    if (!trimmedName || trimmedName.length > 100) {
      throw new Error('タグ名は1文字以上100文字以内にしてください。');
    }

    const existing = await this.findByNormalizedName(normalizedName);
    if (existing && existing.deletedAt === null) {
      return existing;
    }

    const timestamp = (options.now || new Date()).toISOString();
    const tag = existing
      ? {
          ...existing,
          name: trimmedName,
          updatedAt: timestamp,
          deletedAt: null,
        }
      : {
          id: options.id || randomTagId(),
          schemaVersion: 1,
          name: trimmedName,
          normalizedName,
          createdAt: timestamp,
          updatedAt: timestamp,
          deletedAt: null,
        };
    const transaction = this.database.transaction(
      [STORES.tags, STORES.settings],
      'readwrite',
    );
    transaction.objectStore(STORES.tags).put(tag);
    await incrementChangeCountInTransaction(
      transaction.objectStore(STORES.settings),
    );
    await transactionToPromise(transaction);
    return tag;
  }
}
