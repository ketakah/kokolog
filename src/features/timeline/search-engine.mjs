import {
  prepareSearchRecord,
  searchPreparedRecords,
} from '../../domain/search.mjs';

function minimalRecord(record) {
  return {
    id: record.id,
    title: record.title,
    body: record.body,
    mood: record.mood,
    tagIds: record.tagIds,
    favorite: record.favorite,
    occurredAtLocal: record.occurredAtLocal,
  };
}

function createFallbackEngine(records, reason = null) {
  const prepared = records.map(prepareSearchRecord);
  return {
    mode: 'main-thread',
    warning: reason,
    async search(criteria) {
      const startedAt = performance.now();
      return {
        ids: searchPreparedRecords(prepared, criteria),
        durationMs: performance.now() - startedAt,
      };
    },
    terminate() {},
  };
}

export async function createTimelineSearchEngine(records) {
  if (typeof Worker !== 'function') {
    return createFallbackEngine(records, 'Web Workerを利用できないため通常検索へ切り替えました。');
  }

  const worker = new Worker(
    new URL('../../workers/search-worker.mjs', import.meta.url),
    { type: 'module' },
  );
  let requestId = 0;
  const pending = new Map();
  let failed = false;

  const failAll = (error) => {
    failed = true;
    for (const { reject } of pending.values()) {
      reject(error);
    }
    pending.clear();
  };
  worker.addEventListener('message', (event) => {
    const request = pending.get(event.data.requestId);
    if (!request) {
      return;
    }
    pending.delete(event.data.requestId);
    request.resolve(event.data);
  });
  worker.addEventListener('error', (event) => {
    failAll(new Error(event.message || '検索Workerでエラーが発生しました。'));
  });

  function send(type, payload) {
    if (failed) {
      return Promise.reject(new Error('検索Workerを利用できません。'));
    }
    const id = ++requestId;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      worker.postMessage({
        type,
        requestId: id,
        ...payload,
      });
    });
  }

  try {
    await send('init', { records: records.map(minimalRecord) });
  } catch (error) {
    worker.terminate();
    return createFallbackEngine(records, error.message);
  }

  return {
    mode: 'worker',
    warning: null,
    async search(criteria) {
      const result = await send('search', { criteria });
      return {
        ids: result.ids,
        durationMs: result.durationMs,
      };
    },
    terminate() {
      worker.terminate();
      failAll(new Error('検索画面を終了しました。'));
    },
  };
}
