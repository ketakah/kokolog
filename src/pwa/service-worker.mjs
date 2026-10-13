const UPDATE_RELOAD_TIMEOUT_MS = 8000;
const APP_SHELL_CHECK_TIMEOUT_MS = 5000;
const CLIENT_COORDINATION_TIMEOUT_MS = 7000;

function ensureAppShell(worker) {
  if (typeof MessageChannel !== 'function') {
    return Promise.reject(
      new Error('App Shellの確認に必要なMessageChannelを利用できません。'),
    );
  }

  return new Promise((resolve, reject) => {
    const channel = new MessageChannel();
    const timeout = setTimeout(() => {
      channel.port1.close();
      reject(new Error('App Shellの確認がタイムアウトしました。'));
    }, APP_SHELL_CHECK_TIMEOUT_MS);
    channel.port1.onmessage = (event) => {
      clearTimeout(timeout);
      channel.port1.close();
      if (event.data?.success) {
        resolve();
      } else {
        reject(
          new Error(
            event.data?.error || 'App Shellを再構築できませんでした。',
          ),
        );
      }
    };
    worker.postMessage(
      { type: 'ENSURE_APP_SHELL' },
      [channel.port2],
    );
  });
}

async function sendWorkerCommand(type) {
  let registration = await navigator.serviceWorker.getRegistration('./');
  let worker = registration?.active || navigator.serviceWorker.controller;
  if (!worker) {
    registration = await Promise.race([
      navigator.serviceWorker.ready,
      new Promise((_, reject) => {
        setTimeout(
          () => reject(new Error('Service Workerの有効化を待機できませんでした。')),
          CLIENT_COORDINATION_TIMEOUT_MS,
        );
      }),
    ]);
    worker = registration.active || navigator.serviceWorker.controller;
  }
  if (!worker) {
    throw new Error('他のここログ画面を安全に確認できません。');
  }
  return new Promise((resolve, reject) => {
    const channel = new MessageChannel();
    const timeout = setTimeout(() => {
      channel.port1.close();
      reject(new Error('他のここログ画面の確認がタイムアウトしました。'));
    }, CLIENT_COORDINATION_TIMEOUT_MS);
    channel.port1.onmessage = (event) => {
      clearTimeout(timeout);
      channel.port1.close();
      if (event.data?.success) {
        resolve(event.data);
      } else {
        reject(
          new Error(
            event.data?.error || '他のここログ画面を安全に閉じられませんでした。',
          ),
        );
      }
    };
    worker.postMessage({ type }, [channel.port2]);
  });
}

export function prepareOtherClientsForDeletion() {
  return sendWorkerCommand('PREPARE_DELETE');
}

export function cancelDeletionPreparation() {
  return sendWorkerCommand('CANCEL_DELETE');
}

export async function registerKokologServiceWorker(options = {}) {
  if (!('serviceWorker' in navigator)) {
    return null;
  }

  let updateRequested = false;
  let updateInProgress = false;
  let reloadTimer = null;
  let announcedWorker = null;

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!updateRequested) {
      return;
    }
    if (reloadTimer) {
      clearTimeout(reloadTimer);
    }
    globalThis.location.reload();
  });

  const registration = await navigator.serviceWorker.register('./sw.js', {
    scope: './',
    updateViaCache: 'none',
  });

  function announceUpdate(worker) {
    if (!worker || worker === announcedWorker) {
      return;
    }
    announcedWorker = worker;
    options.onUpdateReady?.(async () => {
      if (updateInProgress) {
        return;
      }
      updateInProgress = true;
      try {
        await options.beforeUpdate?.();
        updateRequested = true;
        options.onUpdating?.();
        worker.postMessage({ type: 'SKIP_WAITING' });
        reloadTimer = setTimeout(() => {
          globalThis.location.reload();
        }, UPDATE_RELOAD_TIMEOUT_MS);
      } catch (error) {
        updateInProgress = false;
        updateRequested = false;
        throw error;
      }
    });
  }

  function monitorInstallingWorker() {
    const worker = registration.installing;
    if (!worker) {
      return;
    }
    worker.addEventListener('statechange', () => {
      if (worker.state !== 'installed') {
        return;
      }
      if (registration.active) {
        announceUpdate(worker);
      } else {
        options.onOfflineReady?.();
      }
    });
  }

  if (registration.waiting) {
    announceUpdate(registration.waiting);
  }
  registration.addEventListener('updatefound', monitorInstallingWorker);
  monitorInstallingWorker();
  const activeWorker = registration.active || navigator.serviceWorker.controller;
  if (activeWorker?.state === 'activated') {
    try {
      await ensureAppShell(activeWorker);
    } catch (error) {
      if (typeof options.onAppShellError === 'function') {
        options.onAppShellError(error);
      } else {
        console.error('App Shellを確認できませんでした。', error);
      }
    }
  }
  return registration;
}
