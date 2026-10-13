import {
  STORES,
  closeDatabase,
  countStoreRecords,
  openDatabase,
} from './database.mjs';

const LAST_RECORD_COUNT_KEY = 'kokolog:lastKnownRecordCount';

export class DataIntegrityError extends Error {
  constructor(message) {
    super(message);
    this.name = 'DataIntegrityError';
    this.code = 'SUSPICIOUS_EMPTY_DATABASE';
  }
}

function readLastKnownRecordCount() {
  try {
    const raw = globalThis.localStorage?.getItem(LAST_RECORD_COUNT_KEY);
    if (raw === null || raw === undefined) {
      return { count: 0, warning: null };
    }
    const count = Number(raw);
    return {
      count: Number.isInteger(count) && count >= 0 ? count : 0,
      warning: null,
    };
  } catch (error) {
    return {
      count: 0,
      warning: `前回件数を読み込めませんでした: ${error.message}`,
    };
  }
}

export function rememberRecordCount(count) {
  try {
    globalThis.localStorage?.setItem(LAST_RECORD_COUNT_KEY, String(count));
    return null;
  } catch (error) {
    return `前回件数を保存できませんでした: ${error.message}`;
  }
}

export async function openVerifiedDatabase() {
  const warnings = [];
  const previous = readLastKnownRecordCount();
  if (previous.warning) {
    warnings.push(previous.warning);
  }

  let database = await openDatabase();
  let currentCount = await countStoreRecords(database, STORES.records);

  if (currentCount === 0 && previous.count > 0) {
    closeDatabase();
    database = await openDatabase();
    currentCount = await countStoreRecords(database, STORES.records);

    if (currentCount === 0) {
      closeDatabase();
      throw new DataIntegrityError(
        `前回は${previous.count}件の記録がありましたが、現在は0件として読み込まれました。安全のため書き込みを停止しました。`,
      );
    }
  }

  const warning = rememberRecordCount(currentCount);
  if (warning) {
    warnings.push(warning);
  }

  return {
    database,
    recordCount: currentCount,
    warnings,
  };
}
