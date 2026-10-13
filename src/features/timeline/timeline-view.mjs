import { createDisplayTitle } from '../../domain/display-title.mjs';
import {
  formatRecordTime,
  formatTimelineDate,
  getLocalDateKey,
} from '../../domain/dates.mjs';
import { getMoodLabel, MOODS } from '../../domain/moods.mjs';
import {
  countTimelineFilters,
  createDefaultTimelineFilters,
  tokenizeSearchQuery,
} from '../../domain/search.mjs';
import { button, element } from '../../ui/dom.mjs';
import { createMoodIcon, createStarText } from '../../ui/icons.mjs';
import {
  createBottomTabs,
  createScreen,
  createTopBar,
} from '../../ui/layout.mjs';
import { showToast } from '../../ui/toast.mjs';
import { createTimelineSearchEngine } from './search-engine.mjs';

const INITIAL_VISIBLE_RECORDS = 100;
const SEARCH_DEBOUNCE_MS = 180;

function groupRecordsByDate(records) {
  const groups = [];
  let current = null;

  for (const record of records) {
    const dateKey = getLocalDateKey(record.occurredAtLocal);
    if (!current || current.dateKey !== dateKey) {
      current = { dateKey, records: [] };
      groups.push(current);
    }
    current.records.push(record);
  }
  return groups;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function appendHighlightedText(target, text, query) {
  const source = String(text || '');
  const rawTokens = String(query || '')
    .trim()
    .split(/\s+/u)
    .filter(Boolean)
    .sort((left, right) => right.length - left.length);
  if (rawTokens.length === 0) {
    target.textContent = source;
    return;
  }

  let pattern;
  try {
    pattern = new RegExp(`(${rawTokens.map(escapeRegExp).join('|')})`, 'giu');
  } catch {
    target.textContent = source;
    return;
  }
  let lastIndex = 0;
  for (const match of source.matchAll(pattern)) {
    if (match.index > lastIndex) {
      target.append(document.createTextNode(source.slice(lastIndex, match.index)));
    }
    target.append(element('mark', { text: match[0] }));
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < source.length) {
    target.append(document.createTextNode(source.slice(lastIndex)));
  }
}

export function createRecordCard(record, tagsById, context, options = {}) {
  const query = options.query || '';
  const displayTitle = createDisplayTitle(record);
  const card = element('article', { className: 'record-card card' });
  const main = button('', {
    className: 'record-card-main',
    attributes: {
      'aria-label': `${displayTitle}の詳細を開く`,
    },
    on: {
      click: () => context.router.navigate(`/record/${encodeURIComponent(record.id)}`),
    },
  });

  const meta = element('div', { className: 'record-meta' });
  if (record.mood !== null) {
    meta.append(
      createMoodIcon(record.mood, {
        label: `調子 ${getMoodLabel(record.mood)} ${record.mood}`,
      }),
    );
  }
  meta.append(element('span', { text: formatRecordTime(record.occurredAtLocal) }));
  const heading = element('h3', { className: 'record-heading' });
  appendHighlightedText(heading, displayTitle, query);
  main.append(meta, heading);

  if (record.body.trim()) {
    const excerpt = element('p', { className: 'record-excerpt' });
    appendHighlightedText(excerpt, record.body, query);
    main.append(excerpt);
  }

  const tagNames = record.tagIds
    .map((tagId) => tagsById.get(tagId)?.name)
    .filter(Boolean);
  if (tagNames.length > 0) {
    const tags = element('div', { className: 'record-tags' });
    for (const tagName of tagNames) {
      tags.append(element('span', { className: 'chip', text: tagName }));
    }
    main.append(tags);
  }

  const favorite = button('', {
    className: `favorite-button${record.favorite ? ' is-favorite' : ''}`,
    attributes: {
      'aria-label': record.favorite ? 'お気に入りから外す' : 'お気に入りに追加',
      'aria-pressed': String(record.favorite),
    },
    on: {
      click: async () => {
        favorite.disabled = true;
        try {
          await context.services.records.toggleFavorite(record.id);
          await context.refresh();
        } catch (error) {
          favorite.disabled = false;
          showToast(`お気に入りを変更できませんでした: ${error.message}`, { error: true });
        }
      },
    },
  });
  favorite.append(createStarText(record.favorite));
  card.append(main, favorite);
  return card;
}

function filterLabel(filters, tagsById) {
  const labels = [];
  if (filters.fromDate || filters.toDate) {
    labels.push(
      `${filters.fromDate || '最初'}〜${filters.toDate || '最新'}`,
    );
  }
  if (filters.moods.length > 0 || filters.includeMoodless) {
    const moodLabels = filters.moods.map((value) => String(value));
    if (filters.includeMoodless) {
      moodLabels.push('未入力');
    }
    labels.push(`調子 ${moodLabels.join('・')}`);
  }
  if (filters.favoriteOnly) {
    labels.push('お気に入り');
  }
  if (filters.tagIds.length > 0) {
    const names = filters.tagIds
      .map((tagId) => tagsById.get(tagId)?.name)
      .filter(Boolean);
    labels.push(`${names.join(filters.tagMode === 'or' ? ' OR ' : ' AND ')}`);
  }
  return labels;
}

export async function renderTimelineView(context) {
  const [records, tags] = await Promise.all([
    context.services.records.listActive({
      direction: context.state.timelineDirection,
    }),
    context.services.tags.listActive(),
  ]);
  const tagsById = new Map(tags.map((tag) => [tag.id, tag]));
  const recordsById = new Map(records.map((record) => [record.id, record]));
  const searchEngine = await createTimelineSearchEngine(records);
  let currentResults = [];
  let visibleLimit = INITIAL_VISIBLE_RECORDS;
  let searchTimer = null;
  let searchSequence = 0;
  let isComposing = false;
  let activeSheet = null;
  let filterTrigger = null;

  const screen = createScreen({ withTabs: true });
  screen.append(
    createTopBar({
      title: 'タイムライン',
      right: {
        label: context.state.timelineDirection === 'desc' ? '新しい順' : '古い順',
        onClick: async () => {
          context.state.timelineDirection =
            context.state.timelineDirection === 'desc' ? 'asc' : 'desc';
          await context.refresh();
        },
      },
    }),
  );

  const searchInput = element('input', {
    className: 'field timeline-search-input',
    attributes: {
      type: 'search',
      value: context.state.timelineQuery,
      placeholder: 'タイトル・本文を検索',
      'aria-label': 'タイトル・本文を検索',
      enterkeyhint: 'search',
    },
  });
  const filterButton = button('絞り込み', {
    className: 'timeline-filter-button',
  });
  const activeFilters = element('div', {
    className: 'timeline-active-filters',
    attributes: { 'aria-label': '適用中の絞り込み' },
  });
  const resultStatus = element('div', {
    className: 'timeline-result-status',
    attributes: { role: 'status' },
  });
  const searchArea = element('section', { className: 'timeline-search-area' }, [
    element('div', { className: 'timeline-search-row' }, [
      searchInput,
      filterButton,
    ]),
    activeFilters,
    resultStatus,
  ]);
  const content = element('main', { className: 'timeline-content' });

  function closeFilterSheet() {
    activeSheet?.remove();
    activeSheet = null;
    filterTrigger?.focus();
    filterTrigger = null;
  }

  function currentCriteria() {
    return {
      query: context.state.timelineQuery,
      ...context.state.timelineFilters,
    };
  }

  function renderActiveFilters() {
    activeFilters.replaceChildren();
    const filters = context.state.timelineFilters;
    const labels = filterLabel(filters, tagsById);
    const clearers = [];
    if (filters.fromDate || filters.toDate) {
      clearers.push(() => {
        filters.fromDate = '';
        filters.toDate = '';
      });
    }
    if (filters.moods.length > 0 || filters.includeMoodless) {
      clearers.push(() => {
        filters.moods = [];
        filters.includeMoodless = false;
      });
    }
    if (filters.favoriteOnly) {
      clearers.push(() => {
        filters.favoriteOnly = false;
      });
    }
    if (filters.tagIds.length > 0) {
      clearers.push(() => {
        filters.tagIds = [];
      });
    }
    labels.forEach((label, index) => {
      activeFilters.append(
        button(`${label}　×`, {
          className: 'timeline-filter-chip',
          attributes: { 'aria-label': `${label}を解除` },
          on: {
            click: async () => {
              clearers[index]();
              renderActiveFilters();
              await runSearch();
            },
          },
        }),
      );
    });
    activeFilters.hidden = labels.length === 0;
    const count = countTimelineFilters(filters);
    filterButton.textContent = count > 0 ? `絞り込み ${count}` : '絞り込み';
  }

  function renderResults(durationMs = 0) {
    content.replaceChildren();
    const visible = currentResults.slice(0, visibleLimit);
    const criteriaActive =
      context.state.timelineQuery.trim() ||
      countTimelineFilters(context.state.timelineFilters) > 0;
    resultStatus.textContent = criteriaActive
      ? `${currentResults.length}件（${Math.round(durationMs)}ms）`
      : `${records.length}件の記録`;

    if (currentResults.length === 0) {
      content.append(
        element('section', { className: 'status-panel card' }, [
          element('h2', {
            text: criteriaActive
              ? '条件に一致する記録はありません'
              : '最初の気持ちを残してみましょう',
          }),
          element('p', {
            text: criteriaActive
              ? '検索語や絞り込み条件を変更してください。'
              : '本文、タイトル、調子のいずれか1つだけでも保存できます。',
          }),
          ...(criteriaActive
            ? [
                button('検索と絞り込みをリセット', {
                  className: 'detail-action',
                  on: {
                    click: async () => {
                      context.state.timelineQuery = '';
                      context.state.timelineFilters = createDefaultTimelineFilters();
                      searchInput.value = '';
                      renderActiveFilters();
                      await runSearch();
                    },
                  },
                }),
              ]
            : []),
        ]),
      );
      return;
    }

    for (const group of groupRecordsByDate(visible)) {
      const section = element('section', { className: 'date-group' });
      section.append(
        element('header', { className: 'date-group-header' }, [
          element('strong', {
            text: formatTimelineDate(`${group.dateKey}T00:00:00`),
          }),
          element('span', { text: `${group.records.length}件` }),
        ]),
      );
      for (const record of group.records) {
        section.append(
          createRecordCard(record, tagsById, context, {
            query: context.state.timelineQuery,
          }),
        );
      }
      content.append(section);
    }
    if (visible.length < currentResults.length) {
      content.append(
        button(`さらに表示（残り${currentResults.length - visible.length}件）`, {
          className: 'timeline-load-more',
          on: {
            click: () => {
              visibleLimit += INITIAL_VISIBLE_RECORDS;
              renderResults(durationMs);
            },
          },
        }),
      );
    }
  }

  async function runSearch(options = {}) {
    const sequence = ++searchSequence;
    if (options.resetLimit !== false) {
      visibleLimit = INITIAL_VISIBLE_RECORDS;
    }
    resultStatus.textContent = '検索中…';
    try {
      const result = await searchEngine.search(currentCriteria());
      if (sequence !== searchSequence) {
        return;
      }
      currentResults = result.ids
        .map((id) => recordsById.get(id))
        .filter(Boolean);
      renderResults(result.durationMs);
    } catch (error) {
      if (sequence !== searchSequence) {
        return;
      }
      resultStatus.textContent = '検索に失敗しました';
      showToast(`検索に失敗しました: ${error.message}`, { error: true });
    }
  }

  function openFilterSheet(event) {
    closeFilterSheet();
    filterTrigger = event.currentTarget;
    const local = {
      ...context.state.timelineFilters,
      moods: [...context.state.timelineFilters.moods],
      tagIds: [...context.state.timelineFilters.tagIds],
    };
    const backdrop = element('div', {
      className: 'sheet-backdrop',
      on: { click: closeFilterSheet },
    });
    const sheet = element('section', {
      className: 'bottom-sheet timeline-filter-sheet',
      attributes: {
        role: 'dialog',
        'aria-modal': 'true',
        'aria-labelledby': 'timeline-filter-title',
      },
    });
    const applyButton = button('適用', { className: 'top-bar-action' });
    const header = element('header', { className: 'sheet-header' }, [
      button('取消', {
        className: 'top-bar-action',
        on: { click: closeFilterSheet },
      }),
      element('h2', {
        text: '絞り込み',
        attributes: { id: 'timeline-filter-title' },
      }),
      applyButton,
    ]);
    const body = element('div', { className: 'sheet-body' });
    const fromInput = element('input', {
      className: 'field',
      attributes: {
        type: 'date',
        value: local.fromDate,
        'aria-label': '開始日',
      },
    });
    const toInput = element('input', {
      className: 'field',
      attributes: {
        type: 'date',
        value: local.toDate,
        'aria-label': '終了日',
      },
    });
    const dateRow = element('div', { className: 'timeline-filter-dates' }, [
      fromInput,
      toInput,
    ]);
    const moodRow = element('div', {
      className: 'timeline-filter-moods',
      attributes: { role: 'group', 'aria-label': '調子' },
    });
    const selectedMoods = new Set(local.moods);
    for (const mood of MOODS) {
      const moodButton = button(String(mood.value), {
        className: 'timeline-mood-filter',
        attributes: {
          'aria-label': `${mood.label} ${mood.value}`,
          'aria-pressed': String(selectedMoods.has(mood.value)),
        },
        on: {
          click: (clickEvent) => {
            if (selectedMoods.has(mood.value)) {
              selectedMoods.delete(mood.value);
            } else {
              selectedMoods.add(mood.value);
            }
            clickEvent.currentTarget.setAttribute(
              'aria-pressed',
              String(selectedMoods.has(mood.value)),
            );
          },
        },
      });
      moodRow.append(moodButton);
    }
    const moodlessButton = button('未入力', {
      className: 'timeline-mood-filter',
      attributes: {
        'aria-pressed': String(local.includeMoodless),
      },
      on: {
        click: (clickEvent) => {
          local.includeMoodless = !local.includeMoodless;
          clickEvent.currentTarget.setAttribute(
            'aria-pressed',
            String(local.includeMoodless),
          );
        },
      },
    });
    moodRow.append(moodlessButton);

    const favoriteInput = element('input', {
      attributes: {
        type: 'checkbox',
        id: 'timeline-favorite-only',
      },
    });
    favoriteInput.checked = local.favoriteOnly;
    const favoriteLabel = element('label', {
      className: 'timeline-filter-check',
      attributes: { for: 'timeline-favorite-only' },
    }, [
      favoriteInput,
      document.createTextNode('お気に入りだけ'),
    ]);

    const tagMode = element('div', {
      className: 'timeline-tag-mode',
      attributes: { role: 'group', 'aria-label': 'タグの組み合わせ' },
    });
    const tagModeButtons = {};
    for (const [value, label] of [
      ['and', 'すべて含む'],
      ['or', 'いずれか含む'],
    ]) {
      tagModeButtons[value] = button(label, {
        attributes: { 'aria-pressed': String(local.tagMode === value) },
        on: {
          click: () => {
            local.tagMode = value;
            Object.entries(tagModeButtons).forEach(([key, node]) =>
              node.setAttribute('aria-pressed', String(key === value)),
            );
          },
        },
      });
      tagMode.append(tagModeButtons[value]);
    }

    const selectedTags = new Set(local.tagIds);
    const tagList = element('div', { className: 'timeline-filter-tags' });
    for (const tag of tags) {
      tagList.append(
        button(tag.name, {
          className: 'timeline-tag-filter',
          attributes: {
            'aria-pressed': String(selectedTags.has(tag.id)),
          },
          on: {
            click: (clickEvent) => {
              if (selectedTags.has(tag.id)) {
                selectedTags.delete(tag.id);
              } else {
                selectedTags.add(tag.id);
              }
              clickEvent.currentTarget.setAttribute(
                'aria-pressed',
                String(selectedTags.has(tag.id)),
              );
            },
          },
        }),
      );
    }
    if (tags.length === 0) {
      tagList.append(
        element('p', {
          className: 'timeline-filter-empty',
          text: 'タグはまだありません。',
        }),
      );
    }

    applyButton.addEventListener('click', async () => {
      if (fromInput.value && toInput.value && fromInput.value > toInput.value) {
        showToast('開始日は終了日以前にしてください。', { error: true });
        return;
      }
      context.state.timelineFilters = {
        fromDate: fromInput.value,
        toDate: toInput.value,
        moods: [...selectedMoods].sort(),
        includeMoodless: local.includeMoodless,
        favoriteOnly: favoriteInput.checked,
        tagIds: [...selectedTags],
        tagMode: local.tagMode,
      };
      closeFilterSheet();
      renderActiveFilters();
      await runSearch();
    });

    const resetButton = button('条件をすべてリセット', {
      className: 'text-button danger-button timeline-filter-reset',
      on: {
        click: async () => {
          context.state.timelineFilters = createDefaultTimelineFilters();
          closeFilterSheet();
          renderActiveFilters();
          await runSearch();
        },
      },
    });

    body.append(
      element('span', { className: 'field-label', text: '期間' }),
      dateRow,
      element('span', { className: 'field-label', text: '調子' }),
      moodRow,
      favoriteLabel,
      element('span', { className: 'field-label', text: 'タグの組み合わせ' }),
      tagMode,
      tagList,
      resetButton,
    );
    sheet.append(
      element('div', {
        className: 'sheet-handle',
        attributes: { 'aria-hidden': 'true' },
      }),
      header,
      body,
    );
    activeSheet = element('div', {}, [backdrop, sheet]);
    document.body.append(activeSheet);
    queueMicrotask(() => fromInput.focus());
  }

  filterButton.addEventListener('click', openFilterSheet);
  searchInput.addEventListener('compositionstart', () => {
    isComposing = true;
  });
  searchInput.addEventListener('compositionend', () => {
    isComposing = false;
    context.state.timelineQuery = searchInput.value;
    runSearch();
  });
  searchInput.addEventListener('input', () => {
    if (isComposing) {
      return;
    }
    context.state.timelineQuery = searchInput.value;
    if (searchTimer) {
      clearTimeout(searchTimer);
    }
    searchTimer = setTimeout(() => runSearch(), SEARCH_DEBOUNCE_MS);
  });
  const handleKeyDown = (event) => {
    if (event.key === 'Escape' && activeSheet && !event.isComposing) {
      event.preventDefault();
      closeFilterSheet();
    }
  };
  document.addEventListener('keydown', handleKeyDown);

  renderActiveFilters();
  screen.append(
    searchArea,
    content,
    button('＋ 今を記録', {
      className: 'primary-floating',
      on: { click: () => context.router.navigate('/record/new') },
    }),
    createBottomTabs('timeline', (path) => context.router.navigate(path)),
  );
  await runSearch();
  if (searchEngine.warning) {
    showToast(searchEngine.warning, { error: true, duration: 5000 });
  }

  return {
    element: screen,
    cleanup() {
      if (searchTimer) {
        clearTimeout(searchTimer);
      }
      searchSequence += 1;
      closeFilterSheet();
      searchEngine.terminate();
      document.removeEventListener('keydown', handleKeyDown);
    },
  };
}
