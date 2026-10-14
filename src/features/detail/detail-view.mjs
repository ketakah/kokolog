import { createDisplayTitle } from '../../domain/display-title.mjs';
import { formatRecordDateTime } from '../../domain/dates.mjs';
import { getMoodLabel } from '../../domain/moods.mjs';
import { button, element } from '../../ui/dom.mjs';
import { createMoodIcon, createStarText } from '../../ui/icons.mjs';
import { createScreen, createTopBar } from '../../ui/layout.mjs';
import { showToast } from '../../ui/toast.mjs';
import { attachEdgeSwipeBack } from '../../ui/edge-swipe-back.mjs';

export async function renderDetailView(context, recordId) {
  const [record, tags, revisions] = await Promise.all([
    context.services.records.get(recordId),
    context.services.tags.listActive(),
    context.services.records.listRevisions(recordId),
  ]);
  if (!record || record.deletedAt !== null) {
    throw new Error('記録が見つかりません。');
  }
  const tagsById = new Map(tags.map((tag) => [tag.id, tag]));
  const screen = createScreen();
  const goBack = () =>
    context.router.navigate('/timeline', { replace: true });
  screen.append(
    createTopBar({
      title: '記録',
      left: {
        label: '‹ 戻る',
        onClick: goBack,
      },
      right: {
        label: '編集',
        onClick: () =>
          context.router.navigate(`/record/${encodeURIComponent(record.id)}/edit`),
      },
    }),
  );

  const content = element('article', { className: 'detail-content' });
  content.append(
    element('div', {
      className: 'detail-time',
      text: formatRecordDateTime(record.occurredAtLocal),
    }),
    element('h2', {
      className: 'detail-title',
      text: createDisplayTitle(record, 300),
    }),
  );

  if (record.mood !== null) {
    const mood = element('div', {
      className: 'detail-mood',
      text: '',
    });
    mood.style.color = `var(--cp-mood-${record.mood})`;
    mood.append(
      createMoodIcon(record.mood),
      element('span', { text: `${getMoodLabel(record.mood)}　${record.mood}` }),
    );
    content.append(mood);
  }

  if (record.body.trim()) {
    content.append(element('p', { className: 'detail-body', text: record.body }));
  }

  const tagNames = record.tagIds
    .map((tagId) => tagsById.get(tagId)?.name)
    .filter(Boolean);
  if (tagNames.length > 0) {
    const tagList = element('div', { className: 'record-tags' });
    tagNames.forEach((name) => tagList.append(element('span', { className: 'chip', text: name })));
    content.append(tagList);
  }

  const favoriteButton = button('', {
    className: 'detail-action',
    attributes: {
      'aria-label': record.favorite ? 'お気に入りから外す' : 'お気に入りに追加',
      'aria-pressed': String(record.favorite),
    },
    on: {
      click: async () => {
        favoriteButton.disabled = true;
        try {
          await context.services.records.toggleFavorite(record.id);
          await context.refresh();
        } catch (error) {
          favoriteButton.disabled = false;
          showToast(`お気に入りを変更できませんでした: ${error.message}`, { error: true });
        }
      },
    },
  });
  favoriteButton.append(
    createStarText(record.favorite),
    document.createTextNode(record.favorite ? ' お気に入り' : ' お気に入りに追加'),
  );
  const historyButton = button(`編集履歴 ${revisions.length}件`, {
    className: 'detail-action',
    on: {
      click: () =>
        context.router.navigate(`/record/${encodeURIComponent(record.id)}/history`),
    },
  });
  const trashButton = button('ゴミ箱へ移動', {
    className: 'detail-action danger-button',
    on: {
      click: async () => {
        if (!globalThis.confirm('この記録をゴミ箱へ移動しますか？')) {
          return;
        }
        try {
          await context.services.records.moveToTrash(record.id);
          showToast('記録をゴミ箱へ移動しました。');
          context.router.navigate('/timeline', { replace: true });
        } catch (error) {
          showToast(`ゴミ箱へ移動できませんでした: ${error.message}`, {
            error: true,
          });
        }
      },
    },
  });
  const actions = element('div', { className: 'detail-actions' }, [
    favoriteButton,
    historyButton,
    trashButton,
  ]);
  content.append(
    actions,
    element('section', { className: 'card status-panel' }, [
      element('p', {
        text: `作成 ${new Date(record.createdAt).toLocaleString('ja-JP')} ／ 更新 ${new Date(record.updatedAt).toLocaleString('ja-JP')}`,
      }),
    ]),
  );
  screen.append(content);
  const detachEdgeSwipe = attachEdgeSwipeBack(screen, goBack);
  return {
    element: screen,
    cleanup: detachEdgeSwipe,
  };
}
