import { createDisplayTitle } from '../../domain/display-title.mjs';
import { button, element } from '../../ui/dom.mjs';
import { createScreen, createTopBar } from '../../ui/layout.mjs';
import { showToast } from '../../ui/toast.mjs';

const TRASH_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

function remainingDays(record, now = new Date()) {
  const expiresAt = Date.parse(record.deletedAt) + TRASH_RETENTION_MS;
  return Math.max(0, Math.ceil((expiresAt - now.getTime()) / 86400000));
}

export async function renderTrashView(context) {
  const records = await context.services.records.listTrash();
  const screen = createScreen();
  screen.append(
    createTopBar({
      title: 'ゴミ箱',
      left: {
        label: '‹ 戻る',
        onClick: () => context.router.navigate('/settings', { replace: true }),
      },
      right:
        records.length > 0
          ? {
              label: '空にする',
              onClick: async () => {
                if (
                  !globalThis.confirm(
                    `${records.length}件を完全削除します。元に戻せません。よろしいですか？`,
                  )
                ) {
                  return;
                }
                try {
                  const count = await context.services.records.emptyTrash();
                  showToast(`${count}件を完全削除しました。`);
                  await context.refresh();
                } catch (error) {
                  showToast(`ゴミ箱を空にできませんでした: ${error.message}`, {
                    error: true,
                  });
                }
              },
            }
          : null,
    }),
  );
  const content = element('main', { className: 'trash-content' });
  content.append(
    element('p', {
      className: 'trash-description',
      text: 'ゴミ箱へ移動した記録は30日後に完全削除されます。',
    }),
  );
  if (records.length === 0) {
    content.append(
      element('section', { className: 'status-panel card' }, [
        element('h2', { text: 'ゴミ箱は空です' }),
      ]),
    );
  } else {
    for (const record of records) {
      const card = element('article', { className: 'trash-card card' });
      card.append(
        element('div', { className: 'trash-meta' }, [
          element('span', {
            text: `削除 ${new Date(record.deletedAt).toLocaleString('ja-JP')}`,
          }),
          element('strong', { text: `あと${remainingDays(record)}日` }),
        ]),
        element('h2', { text: createDisplayTitle(record) }),
      );
      if (record.body.trim()) {
        card.append(
          element('p', { className: 'trash-excerpt', text: record.body }),
        );
      }
      card.append(
        element('div', { className: 'trash-actions' }, [
          button('復元', {
            className: 'detail-action',
            on: {
              click: async () => {
                try {
                  await context.services.records.restoreFromTrash(record.id);
                  showToast('ゴミ箱から復元しました。');
                  await context.refresh();
                } catch (error) {
                  showToast(`記録を復元できませんでした: ${error.message}`, {
                    error: true,
                  });
                }
              },
            },
          }),
          button('完全削除', {
            className: 'detail-action danger-button',
            on: {
              click: async () => {
                if (!globalThis.confirm('この記録を完全削除します。元に戻せません。')) {
                  return;
                }
                try {
                  await context.services.records.permanentlyDelete(record.id);
                  showToast('記録を完全削除しました。');
                  await context.refresh();
                } catch (error) {
                  showToast(`記録を完全削除できませんでした: ${error.message}`, {
                    error: true,
                  });
                }
              },
            },
          }),
        ]),
      );
      content.append(card);
    }
  }
  screen.append(content);
  return { element: screen };
}
