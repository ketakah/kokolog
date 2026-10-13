import {
  prepareSearchRecord,
  searchPreparedRecords,
} from '../domain/search.mjs';

let preparedRecords = [];

self.addEventListener('message', (event) => {
  const message = event.data;
  if (message.type === 'init') {
    const startedAt = performance.now();
    preparedRecords = message.records.map(prepareSearchRecord);
    self.postMessage({
      type: 'ready',
      requestId: message.requestId,
      count: preparedRecords.length,
      durationMs: performance.now() - startedAt,
    });
    return;
  }
  if (message.type === 'search') {
    const startedAt = performance.now();
    const ids = searchPreparedRecords(preparedRecords, message.criteria);
    self.postMessage({
      type: 'result',
      requestId: message.requestId,
      ids,
      durationMs: performance.now() - startedAt,
    });
  }
});
