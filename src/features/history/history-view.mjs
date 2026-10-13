import { createDisplayTitle } from '../../domain/display-title.mjs';
import { getMoodLabel } from '../../domain/moods.mjs';
import { button, element } from '../../ui/dom.mjs';
import { createMoodIcon } from '../../ui/icons.mjs';
import { createScreen, createTopBar } from '../../ui/layout.mjs';
import { showToast } from '../../ui/toast.mjs';

export async function renderHistoryView(context, recordId) {
  const [record, revisions] = await Promise.all([
    context.services.records.get(recordId),
    context.services.records.listRevisions(recordId),
  ]);
  if (!record || record.deletedAt !== null) {
    throw new Error('編集履歴を表示する記録が見つかりません。');
  }

  const screen = createScreen();
  screen.append(
    createTopBar({
      title: '編集履歴',
      left: {
        label: '‹ 戻る',
        onClick: () =>
          context.router.navigate(`/record/${encodeURIComponent(recordId)}`, {
            replace: true,
          }),
      },
    }),
  );
  const content = element('main', { className: 'history-content' });
  content.append(
    element('p', {
      className: 'history-description',
      text: '直近10版を30日間保持します。復元前の現在版も履歴に残ります。',
    }),
  );

  if (revisions.length === 0) {
    content.append(
      element('section', { className: 'status-panel card' }, [
        element('h2', { text: '編集履歴はまだありません' }),
        element('p', { text: '記録を編集して保存すると、変更前の内容がここに残ります。' }),
      ]),
    );
  } else {
    for (const revision of revisions) {
      const card = element('article', { className: 'history-card card' });
      const meta = element('div', { className: 'history-meta' }, [
        element('strong', {
          text: new Date(revision.savedAt).toLocaleString('ja-JP'),
        }),
        element('span', { text: `版 ${revision.revision}` }),
      ]);
      const title = element('h2', {
        text: createDisplayTitle(revision.snapshot),
      });
      card.append(meta, title);
      if (revision.snapshot.mood !== null) {
        const mood = element('div', { className: 'history-mood' });
        mood.style.color = `var(--cp-mood-${revision.snapshot.mood})`;
        mood.append(
          createMoodIcon(revision.snapshot.mood),
          element('span', {
            text: `${getMoodLabel(revision.snapshot.mood)} ${revision.snapshot.mood}`,
          }),
        );
        card.append(mood);
      }
      if (revision.snapshot.body.trim()) {
        card.append(
          element('p', {
            className: 'history-excerpt',
            text: revision.snapshot.body,
          }),
        );
      }
      card.append(
        button('この版を復元', {
          className: 'detail-action',
          on: {
            click: async () => {
              if (!globalThis.confirm('現在の内容を履歴へ残し、この版を復元しますか？')) {
                return;
              }
              try {
                await context.services.records.restoreRevision(revision.id);
                showToast('編集履歴から復元しました。');
                context.router.navigate(`/record/${encodeURIComponent(recordId)}`, {
                  replace: true,
                });
              } catch (error) {
                showToast(`履歴を復元できませんでした: ${error.message}`, {
                  error: true,
                });
              }
            },
          },
        }),
      );
      content.append(card);
    }
  }
  screen.append(content);
  return { element: screen };
}
