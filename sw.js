const CACHE_PREFIX = 'kokolog-';
const CACHE_NAME = 'kokolog-app-v22';
const APP_SHELL = Object.freeze([
  './',
  './index.html',
  './manifest.webmanifest',
  './styles/tokens.css',
  './styles/base.css',
  './styles/components.css',
  './styles/screens.css',
  './icons/icon-180.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './assets/icons/mood-1.svg',
  './assets/icons/mood-2.svg',
  './assets/icons/mood-3.svg',
  './assets/icons/mood-4.svg',
  './assets/icons/mood-5.svg',
  './src/app/router.mjs',
  './src/app/state.mjs',
  './src/app/theme.mjs',
  './src/data/backup-service.mjs',
  './src/data/database.mjs',
  './src/data/delete-all-service.mjs',
  './src/data/drafts-repository.mjs',
  './src/data/records-repository.mjs',
  './src/data/safety-guard.mjs',
  './src/data/services.mjs',
  './src/data/settings-repository.mjs',
  './src/data/storage-service.mjs',
  './src/data/tags-repository.mjs',
  './src/domain/backup.mjs',
  './src/domain/calendar.mjs',
  './src/domain/dates.mjs',
  './src/domain/display-title.mjs',
  './src/domain/moods.mjs',
  './src/domain/record.mjs',
  './src/domain/search.mjs',
  './src/domain/statistics.mjs',
  './src/domain/storage.mjs',
  './src/features/calendar/calendar-view.mjs',
  './src/features/calendar/day-view.mjs',
  './src/features/detail/detail-view.mjs',
  './src/features/delete-all/delete-all-view.mjs',
  './src/features/editor/editor-view.mjs',
  './src/features/editor/draft-save-coordinator.mjs',
  './src/features/history/history-view.mjs',
  './src/features/lock/lock-view.mjs',
  './src/features/pin/pin-settings-view.mjs',
  './src/features/pin/pin-reauth.mjs',
  './src/features/placeholders/placeholder-view.mjs',
  './src/features/settings/settings-view.mjs',
  './src/features/settings/backup-export.mjs',
  './src/features/storage/storage-view.mjs',
  './src/features/statistics/statistics-view.mjs',
  './src/features/timeline/search-engine.mjs',
  './src/features/timeline/timeline-view.mjs',
  './src/features/theme/theme-view.mjs',
  './src/features/trash/trash-view.mjs',
  './src/main.mjs',
  './src/pwa/service-worker.mjs',
  './src/security/pin-service.mjs',
  './src/ui/dom.mjs',
  './src/ui/download.mjs',
  './src/ui/icons.mjs',
  './src/ui/layout.mjs',
  './src/ui/toast.mjs',
  './src/workers/search-worker.mjs',
]);
let deletionPending = false;

function shellUrl(relativePath) {
  return new URL(relativePath, self.registration.scope).href;
}

async function ensureAppShellCache() {
  const cache = await caches.open(CACHE_NAME);
  const urls = APP_SHELL.map(shellUrl);
  const cached = await Promise.all(urls.map((url) => cache.match(url)));
  if (cached.some((response) => !response)) {
    await cache.addAll(urls);
  }
}

function requestClientDeletionAcknowledgement(client) {
  return new Promise((resolve, reject) => {
    const channel = new MessageChannel();
    const timeout = setTimeout(() => {
      channel.port1.close();
      reject(new Error('別画面から削除準備の応答がありません。'));
    }, 4000);
    channel.port1.onmessage = (event) => {
      clearTimeout(timeout);
      channel.port1.close();
      if (event.data?.success) {
        resolve();
      } else {
        reject(
          new Error(
            event.data?.error || '別画面を安全に閉じられませんでした。',
          ),
        );
      }
    };
    client.postMessage(
      { type: 'KOKOLOG_DELETE_PENDING' },
      [channel.port2],
    );
  });
}

async function prepareClientsForDeletion(sourceId) {
  deletionPending = true;
  try {
    const windows = await self.clients.matchAll({
      type: 'window',
      includeUncontrolled: true,
    });
    const otherWindows = windows.filter((client) => client.id !== sourceId);
    await Promise.all(
      otherWindows.map(requestClientDeletionAcknowledgement),
    );
    return otherWindows.length;
  } catch (error) {
    deletionPending = false;
    throw error;
  }
}

self.addEventListener('install', (event) => {
  event.waitUntil(ensureAppShellCache());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter(
              (key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME,
            )
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') {
    return;
  }

  const requestUrl = new URL(event.request.url);
  const scopeUrl = new URL(self.registration.scope);
  if (
    requestUrl.origin !== scopeUrl.origin ||
    !requestUrl.pathname.startsWith(scopeUrl.pathname)
  ) {
    return;
  }

  if (deletionPending && event.request.mode === 'navigate') {
    event.respondWith(
      Promise.resolve(
        new Response(
          '<!doctype html><html lang="ja"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>ここログ</title><body><main><h1>この端末のデータを削除しています</h1><p>開いているここログへ戻って完了を確認してください。</p></main></body></html>',
          {
            status: 503,
            headers: {
              'Content-Type': 'text/html; charset=utf-8',
              'Cache-Control': 'no-store',
            },
          },
        ),
      ),
    );
    return;
  }

  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      const cached = await cache.match(event.request);
      if (cached) {
        return cached;
      }
      const indexUrl = new URL('./index.html', self.registration.scope);
      const isAppNavigation =
        event.request.mode === 'navigate' &&
        (requestUrl.pathname === scopeUrl.pathname ||
          requestUrl.pathname === indexUrl.pathname);
      if (isAppNavigation) {
        const shell = await cache.match(indexUrl.href);
        if (shell) {
          return shell;
        }
      }

      try {
        return await fetch(event.request);
      } catch (error) {
        if (isAppNavigation) {
          const fallback = await cache.match(indexUrl.href);
          if (fallback) {
            return fallback;
          }
        }
        throw error;
      }
    })(),
  );
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') {
    self.skipWaiting();
    return;
  }
  if (event.data?.type === 'ENSURE_APP_SHELL') {
    const ensure = ensureAppShellCache();
    event.waitUntil(ensure);
    ensure.then(
      () => event.ports[0]?.postMessage({ success: true }),
      (error) =>
        event.ports[0]?.postMessage({
          success: false,
          error: error?.message || String(error),
        }),
    );
    return;
  }
  if (event.data?.type === 'PREPARE_DELETE') {
    const prepare = prepareClientsForDeletion(event.source?.id || null);
    event.waitUntil(prepare);
    prepare.then(
      (clientCount) =>
        event.ports[0]?.postMessage({
          success: true,
          clientCount,
        }),
      (error) =>
        event.ports[0]?.postMessage({
          success: false,
          error: error?.message || String(error),
        }),
    );
    return;
  }
  if (event.data?.type === 'CANCEL_DELETE') {
    deletionPending = false;
    event.ports[0]?.postMessage({ success: true });
  }
});
