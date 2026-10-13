import { createRouter } from './app/router.mjs';
import { createAppState } from './app/state.mjs';
import { ThemeManager } from './app/theme.mjs';
import { closeDatabase } from './data/database.mjs';
import { DataIntegrityError } from './data/safety-guard.mjs';
import { createDataServices } from './data/services.mjs';
import { renderDetailView } from './features/detail/detail-view.mjs';
import { renderEditorView } from './features/editor/editor-view.mjs';
import { renderCalendarView } from './features/calendar/calendar-view.mjs';
import { renderDayView } from './features/calendar/day-view.mjs';
import { renderSettingsView } from './features/settings/settings-view.mjs';
import { renderHistoryView } from './features/history/history-view.mjs';
import { renderTrashView } from './features/trash/trash-view.mjs';
import { renderLockView } from './features/lock/lock-view.mjs';
import { renderPinSettingsView } from './features/pin/pin-settings-view.mjs';
import { renderStatisticsView } from './features/statistics/statistics-view.mjs';
import { renderTimelineView } from './features/timeline/timeline-view.mjs';
import { renderThemeView } from './features/theme/theme-view.mjs';
import { renderStorageView } from './features/storage/storage-view.mjs';
import { renderDeleteAllView } from './features/delete-all/delete-all-view.mjs';
import { registerKokologServiceWorker } from './pwa/service-worker.mjs';
import { cancelDeletionPreparation } from './pwa/service-worker.mjs';
import { button, element } from './ui/dom.mjs';
import { showToast } from './ui/toast.mjs';
import { PinService } from './security/pin-service.mjs';
import { IdleLockController } from './security/idle-lock-controller.mjs';

const root = document.getElementById('app');
const privacyCover = document.getElementById('privacy-cover');
const state = createAppState();
let services = null;
let pinService = null;
let themeManager = null;
let currentCleanup = null;
let currentBeforeAppUpdate = null;
let currentRoute = null;
let renderSequence = 0;
let routerStarted = false;
let appLocked = false;
let lockOnResume = false;
let idleLockSuspended = false;
const ROUTE_LOADING_DELAY_MS = 150;
const idleLock = new IdleLockController({
  getDelay: () =>
    idleLockSuspended || appLocked
      ? 0
      : pinService?.getAutoLockMsInMemory() || 0,
  onLock: () => lockApp(),
  onError: (error) => {
    console.error('無操作ロックに失敗しました。', error);
    showToast(`無操作ロックに失敗しました: ${error.message}`, {
      error: true,
      duration: 6000,
    });
  },
});

function showPrivacyCover() {
  if (!privacyCover) {
    return;
  }
  privacyCover.hidden = false;
  privacyCover.setAttribute('aria-hidden', 'false');
}

function hidePrivacyCover() {
  if (!privacyCover) {
    return;
  }
  privacyCover.hidden = true;
  privacyCover.setAttribute('aria-hidden', 'true');
}

async function handleServiceWorkerMessage(event) {
  if (event.data?.type !== 'KOKOLOG_DELETE_PENDING') {
    return;
  }
  try {
    showPrivacyCover();
    if (routerStarted) {
      router.stop();
      routerStarted = false;
    }
    replaceRoot(
      element('main', { className: 'integrity-screen' }, [
        element('section', { className: 'integrity-card card' }, [
          element('h1', { text: '別の画面で全データを削除しています' }),
          element('p', {
            text: 'この画面の記録表示とデータベース接続を閉じました。削除完了後に開き直してください。',
          }),
        ]),
      ]),
    );
    closeDatabase();
    event.ports[0]?.postMessage({ success: true });
  } catch (error) {
    console.error('全データ削除に備えて画面を閉じられませんでした。', error);
    event.ports[0]?.postMessage({
      success: false,
      error: error.message,
    });
  }
}

function replaceRoot(node) {
  if (typeof currentCleanup === 'function') {
    currentCleanup();
  }
  currentCleanup = null;
  currentBeforeAppUpdate = null;
  root.replaceChildren(node);
}

function renderLoading() {
  replaceRoot(
    element('main', { className: 'boot-screen' }, [
      element('div', { className: 'app-mark', text: 'ここ', attributes: { 'aria-hidden': 'true' } }),
      element('p', { text: '記録を読み込んでいます…' }),
    ]),
  );
}

function renderIntegrityFailure(error) {
  replaceRoot(
    element('main', { className: 'integrity-screen' }, [
      element('section', { className: 'integrity-card card' }, [
        element('h1', { text: '記録を安全に読み込めませんでした' }),
        element('p', { text: error.message }),
        element('p', {
          text: 'この状態では新規保存や編集を行いません。アプリを完全に終了してから再度開いてください。',
        }),
        button('再読み込み', {
          className: 'detail-action',
          on: { click: () => globalThis.location.reload() },
        }),
      ]),
    ]),
  );
}

function renderRouteError(error) {
  console.error('画面の表示に失敗しました。', error);
  replaceRoot(
    element('main', { className: 'integrity-screen' }, [
      element('section', { className: 'integrity-card card' }, [
        element('h1', { text: '画面を表示できませんでした' }),
        element('p', { text: error.message || '不明なエラーが発生しました。' }),
        element('div', { className: 'detail-actions' }, [
          button('再試行', {
            className: 'detail-action',
            on: { click: () => renderCurrentRoute() },
          }),
          button('タイムラインへ戻る', {
            className: 'detail-action',
            on: { click: () => router.navigate('/timeline') },
          }),
        ]),
      ]),
    ]),
  );
}

const router = createRouter((route) => renderRoute(route));

function startRouter() {
  appLocked = false;
  idleLockSuspended = false;
  if (!routerStarted) {
    router.start();
    routerStarted = true;
  } else {
    router.refresh();
  }
  idleLock.start();
}

async function lockApp() {
  idleLock.stop();
  idleLockSuspended = false;
  if (appLocked || !pinService || !(await pinService.isEnabled())) {
    return;
  }
  appLocked = true;
  if (routerStarted) {
    router.stop();
    routerStarted = false;
  }
  const view = await renderLockView(pinService, {
    onUnlock: () => startRouter(),
  });
  replaceRoot(view.element);
  currentCleanup = view.cleanup || null;
  currentBeforeAppUpdate = view.beforeAppUpdate || null;
  view.afterRender?.();
}

function createContext() {
  return {
    services,
    state,
    router,
    pin: pinService,
    theme: themeManager,
    lock: {
      lockNow: () => lockApp(),
      resetIdle: () => idleLock.reset(),
      pauseIdle: () => {
        idleLockSuspended = true;
        idleLock.stop();
      },
      resumeIdle: () => {
        idleLockSuspended = false;
        idleLock.reset();
      },
    },
    refresh: () => renderCurrentRoute(),
  };
}

async function resolveView(route) {
  const context = createContext();
  switch (route.name) {
    case 'timeline':
      return renderTimelineView(context);
    case 'record-new':
      return renderEditorView(context, {
        initialDate: route.query.get('date'),
      });
    case 'record-edit':
      return renderEditorView(context, { recordId: route.id });
    case 'record-detail':
      return renderDetailView(context, route.id);
    case 'record-history':
      return renderHistoryView(context, route.id);
    case 'calendar':
      return renderCalendarView(context, route.query);
    case 'day':
      return renderDayView(context, route.date);
    case 'statistics':
      return renderStatisticsView(context, route.query);
    case 'settings':
      return renderSettingsView(context);
    case 'settings-trash':
      return renderTrashView(context);
    case 'settings-pin':
      return renderPinSettingsView(context);
    case 'settings-theme':
      return renderThemeView(context);
    case 'settings-storage':
      return renderStorageView(context);
    case 'settings-delete-all':
      return renderDeleteAllView(context);
    case 'not-found':
      router.navigate('/timeline', { replace: true });
      return null;
    default:
      throw new Error(`未対応の画面です: ${route.name}`);
  }
}

async function renderRoute(route) {
  currentRoute = route;
  const sequence = ++renderSequence;
  const loadingTimer = setTimeout(() => {
    if (sequence === renderSequence) {
      renderLoading();
    }
  }, ROUTE_LOADING_DELAY_MS);
  try {
    const view = await resolveView(route);
    clearTimeout(loadingTimer);
    if (!view || sequence !== renderSequence) {
      view?.cleanup?.();
      return;
    }
    replaceRoot(view.element);
    currentCleanup = view.cleanup || null;
    currentBeforeAppUpdate = view.beforeAppUpdate || null;
    view.afterRender?.();
    if (route.name === 'record-detail') {
      globalThis.scrollTo(0, 0);
      requestAnimationFrame(() => globalThis.scrollTo(0, 0));
    }
  } catch (error) {
    clearTimeout(loadingTimer);
    if (sequence !== renderSequence) {
      return;
    }
    renderRouteError(error);
  }
}

function renderCurrentRoute() {
  if (!currentRoute) {
    return Promise.resolve();
  }
  return renderRoute(currentRoute);
}

async function prepareForAppUpdate() {
  if (typeof currentBeforeAppUpdate === 'function') {
    await currentBeforeAppUpdate();
  }
  closeDatabase();
}

async function setupServiceWorker() {
  if (!('serviceWorker' in navigator)) {
    return;
  }
  try {
    navigator.serviceWorker.addEventListener(
      'message',
      handleServiceWorkerMessage,
    );
    await registerKokologServiceWorker({
      beforeUpdate: prepareForAppUpdate,
      onOfflineReady: () => {
        showToast('オフライン利用の準備ができました。', { duration: 4000 });
      },
      onUpdateReady: (applyUpdate) => {
        showToast('新しいバージョンを利用できます。', {
          duration: 0,
          actionLabel: '更新する',
          onAction: applyUpdate,
          onActionError: (error) => {
            console.error('アプリを更新できませんでした。', error);
            showToast(`アプリを更新できませんでした: ${error.message}`, {
              error: true,
              duration: 6000,
            });
          },
        });
      },
      onUpdating: () => {
        showToast('下書きとデータベースを安全に閉じて更新しています…', {
          duration: 0,
        });
      },
      onAppShellError: (error) => {
        console.error('App Shellを準備できませんでした。', error);
        showToast(`オフライン用ファイルを準備できませんでした: ${error.message}`, {
          error: true,
          duration: 7000,
        });
      },
    });
    if (localStorage.getItem('kokolog:resetAfterDelete') === '1') {
      await cancelDeletionPreparation();
      localStorage.removeItem('kokolog:resetAfterDelete');
    }
  } catch (error) {
    console.error('Service Workerを登録できませんでした。', error);
    showToast(`オフライン機能を準備できませんでした: ${error.message}`, {
      error: true,
      duration: 6000,
    });
  }
}

async function start() {
  try {
    const result = await createDataServices();
    services = result;
    pinService = new PinService(result.settings);
    themeManager = new ThemeManager(result.settings);
    await themeManager.initialize();
    if (await pinService.isEnabled()) {
      await lockApp();
    } else {
      startRouter();
    }
    for (const warning of result.warnings) {
      showToast(warning, { error: true, duration: 5000 });
    }
    try {
      await result.settings.markSuccessfulStart();
    } catch (error) {
      console.error('最終正常起動日時を保存できませんでした。', error);
      showToast(`正常起動日時を保存できませんでした: ${error.message}`, {
        error: true,
        duration: 5000,
      });
    }

    function prepareBackgroundLock(renderLock = true) {
      idleLock.stop();
      if (!pinService?.isEnabledInMemory()) {
        return;
      }
      lockOnResume = true;
      showPrivacyCover();
      if (renderLock) {
        lockApp().catch((error) => {
          console.error('バックグラウンド移行時にロックできませんでした。', error);
        });
      }
    }

    async function ensureResumeLock() {
      if (!pinService) {
        hidePrivacyCover();
        return;
      }
      let safeToReveal = false;
      try {
        const config = await pinService.getConfig();
        if (config && lockOnResume) {
          await lockApp();
        } else if (!config && appLocked) {
          startRouter();
        } else if (config && !appLocked) {
          idleLock.start();
        }
        lockOnResume = false;
        safeToReveal = true;
      } catch (error) {
        console.error('復帰時のPIN設定を確認できませんでした。', error);
        showToast('安全のため画面を隠しています。アプリを終了して開き直してください。', {
          error: true,
          duration: 7000,
        });
      } finally {
        if (safeToReveal) {
          hidePrivacyCover();
        }
      }
    }

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') {
        prepareBackgroundLock(true);
      } else {
        ensureResumeLock();
      }
    });
    globalThis.addEventListener('pagehide', () => prepareBackgroundLock(false));
    globalThis.addEventListener('pageshow', () => {
      if (document.visibilityState === 'visible' && lockOnResume) {
        ensureResumeLock();
      }
    });

    const activityOptions = { capture: true, passive: true };
    for (const eventName of ['pointerdown', 'touchstart', 'wheel']) {
      document.addEventListener(eventName, () => {
        if (
          document.visibilityState === 'visible' &&
          !appLocked &&
          pinService?.isEnabledInMemory() &&
          !idleLockSuspended
        ) {
          idleLock.reset();
        }
      }, activityOptions);
    }
    for (const eventName of ['keydown', 'input']) {
      document.addEventListener(eventName, () => {
        if (
          document.visibilityState === 'visible' &&
          !appLocked &&
          pinService?.isEnabledInMemory() &&
          !idleLockSuspended
        ) {
          idleLock.reset();
        }
      }, true);
    }
    globalThis.addEventListener('offline', () => {
      showToast('オフラインです。端末内の記録は引き続き利用できます。', {
        duration: 5000,
      });
    });
    globalThis.addEventListener('online', () => {
      showToast('オンラインに戻りました。', { duration: 3500 });
    });
    await setupServiceWorker();
  } catch (error) {
    if (error instanceof DataIntegrityError) {
      renderIntegrityFailure(error);
      return;
    }
    renderRouteError(error);
  }
}

globalThis.addEventListener('unhandledrejection', (event) => {
  console.error('未処理の非同期エラーが発生しました。', event.reason);
  showToast(`処理に失敗しました: ${event.reason?.message || event.reason}`, {
    error: true,
    duration: 5000,
  });
});
globalThis.addEventListener('beforeunload', () => {
  themeManager?.destroy();
  closeDatabase();
});

start();
