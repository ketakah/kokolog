import {
  formatStorageBytes,
  storageUsagePercent,
} from '../../domain/storage.mjs';
import { button, element } from '../../ui/dom.mjs';
import { createScreen, createTopBar } from '../../ui/layout.mjs';
import { showToast } from '../../ui/toast.mjs';

function formatDateTime(value) {
  return value ? new Date(value).toLocaleString('ja-JP') : '未実施';
}

function metric(label, value) {
  return element('div', { className: 'storage-metric' }, [
    element('span', { text: label }),
    element('strong', { text: value }),
  ]);
}

export async function renderStorageView(context) {
  const [counts, browser, backupStatus, lastSuccessfulStartAt] =
    await Promise.all([
      context.services.storage.getStorageCounts(context.services.database),
      context.services.storage.getBrowserStorageInfo(),
      context.services.settings.getBackupStatus(),
      context.services.settings.getLastSuccessfulStart(),
    ]);
  const trashCount = (await context.services.records.listTrash()).length;
  const activeRecordCount = Math.max(0, counts.records - trashCount);
  const usagePercent = storageUsagePercent(browser.usage, browser.quota);

  const screen = createScreen();
  screen.append(
    createTopBar({
      title: 'ストレージ',
      left: {
        label: '‹ 戻る',
        onClick: () => context.router.back('/settings'),
      },
    }),
  );
  const content = element('main', { className: 'settings-content' });
  content.append(
    element('section', { className: 'card storage-summary' }, [
      element('h2', { text: '端末内データ' }),
      element('div', { className: 'storage-grid' }, [
        metric('通常記録', `${activeRecordCount}件`),
        metric('ゴミ箱', `${trashCount}件`),
        metric('編集履歴', `${counts.revisions}件`),
        metric('削除墓標', `${counts.tombstones}件`),
        metric('タグ', `${counts.tags}件`),
        metric('下書き', `${counts.drafts}件`),
        metric('スナップショット', `${counts.snapshots}件`),
        metric('検索内部情報', `${counts.searchMeta}件`),
      ]),
    ]),
    element('section', { className: 'card storage-summary' }, [
      element('h2', { text: 'ブラウザーストレージ概算' }),
      metric('使用量', formatStorageBytes(browser.usage)),
      metric('割り当て上限', formatStorageBytes(browser.quota)),
      metric(
        '使用率',
        usagePercent === null ? '取得できません' : `${usagePercent.toFixed(2)}%`,
      ),
      element('p', {
        className: 'settings-note',
        text: '値はブラウザーによる同一オリジン全体の概算です。圧縮や端末状況により実容量とは異なります。',
      }),
    ]),
    element('section', { className: 'card storage-summary' }, [
      element('h2', { text: '保持とオフライン' }),
      metric(
        'Persistent Storage',
        browser.persistent === true
          ? '許可済み'
          : browser.persistent === false
            ? '未許可'
            : '状態取得非対応',
      ),
      metric(
        'Service Worker',
        browser.serviceWorkerActive ? '有効' : '未準備',
      ),
      metric(
        'App Shell',
        browser.cacheNames.length > 0
          ? `${browser.cacheNames.length}世代`
          : '未準備',
      ),
      browser.persistenceSupported && browser.persistent !== true
        ? button('保持をリクエスト', {
            className: 'detail-action',
            on: {
              click: async (event) => {
                event.currentTarget.disabled = true;
                try {
                  const result =
                    await context.services.storage.requestPersistentStorage();
                  showToast(
                    result.persistent
                      ? 'ブラウザーが保持を許可しました。'
                      : 'ブラウザーは保持を許可しませんでした。バックアップを継続してください。',
                    { duration: 6000 },
                  );
                  await context.refresh();
                } catch (error) {
                  event.currentTarget.disabled = false;
                  showToast(`保持をリクエストできませんでした: ${error.message}`, {
                    error: true,
                    duration: 6000,
                  });
                }
              },
            },
          })
        : null,
      element('p', {
        className: 'settings-note',
        text: '許可済みでも永久保持は保証されません。機種変更やデータ消去に備えて完全JSONを保存してください。',
      }),
    ]),
    element('section', { className: 'card storage-summary' }, [
      element('h2', { text: '最終確認日時' }),
      metric('正常起動', formatDateTime(lastSuccessfulStartAt)),
      metric('完全JSON', formatDateTime(backupStatus.lastFullBackupAt)),
    ]),
  );
  screen.append(content);
  return { element: screen };
}
